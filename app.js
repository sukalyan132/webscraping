var express = require('express');
var request = require('request');
var cheerio = require('cheerio');
var fs      = require('fs');
var sqlite3 = require("sqlite3");
var xlsx    = require("xlsx");
var app     = express();
var URL     = require("url");
var db      = new sqlite3.Database("./db.sqlite");
var parsedResults = [];
db.run("CREATE TABLE IF NOT EXISTS cars (date varchar(255), time varchar(255), brand varchar(255), model varchar(255), model_year varchar(255), engine_capacity varchar(255), mileage varchar(255), price varchar(255), transmission varchar(255), body_type varchar(255), fuel varchar(255), number varchar(255), district varchar(255), city varchar(255), title varchar(255), owner varchar(255), url varchar(255), cars varchar(255))", function (err) {
    if (err)
        throw err;
});

var replaceList = JSON.parse(fs.readFileSync("./replace.json").toString());
function scrapeList(url) {
    request(url, function (err, res, html) {
        if (!err) {
            var $ = cheerio.load(html);
            $(".ui-item > div > a").each(function (index, element) {
                var link = $(this);
                var text = link.text();
                var href = link.attr("href");
                if (text.length == 0 || text.search("TOP AD") != -1)
                    return;
                scrapeAd(URL.resolve(url, href));
            });
        }
        else {
            console.error(err);
        }
    });
}
function scrapeAd(url) {
    request(url, function (err, res, html) {
        if (!err) {
            var $ = cheerio.load(html);
            var title = $(".item-top > h1").eq(0).text();
            var pairs = [];
            $("dl").each(function () {
                var data = $(this);
                var key = data.children().first().text();
                var value = data.children().eq(1).text();
                pairs.push({ key: key.trim(), value: value.trim() });
            });
            var obj = populateProps(pairs);
            if (!obj) {
                return;
            }
            var cars = $(".ui-crumb").eq(2).children().first().text();
            obj["Cars"] = cars;
            obj["Title"] = title;
            obj["URL"] = url;
            var price = $(".ui-price-tag > span.amount").text();
            obj["Price"] = price;
            var contact = $(".clearfix > .h3").first().text();
            obj["Number"] = contact;
            var location = $(".location").first().text();
            obj["Location"] = location;
            var date = $(".date").first().text();
            obj["Date"] = date;
            var poster = $(".poster").first().text().replace("For sale by ", "").trim();
            obj["Owner"] = poster;
            obj = fixProps(obj);
            // At this stage we now have a fully populated object.
            insertIntoDatabase(obj);
            var metadata = {
                            cars: cars,
                            title: title,
                            url: url,
                            Number: contact,
                            username: location,
                            comments: poster
                          };
            // Push meta-data into parsedResults array
            parsedResults.push(metadata);
        }
        else {
            console.error(err);
        }
    });
}
var props = ["Brand:", "Model year:", "Model:", "Mileage:", "Transmission:", "Body type:", "Fuel type:", "Engine capacity:"];
function populateProps(pairs) {
    var out = [];
    pairs.forEach(function (pair, i2) {
        props.forEach(function (prop, i) {
            if (prop.indexOf(pair.key) == 0) {
                out[props[i].slice(0, props[i].length - 1)] = pair.value;
                delete pairs[i2];
            }
        });
    });
    pairs.forEach(function (pair) {
        if (pair.key === "Item type:") {
            //Car accessory and we don't want that
            return null;
        }
    });
    return out;
}
function findMatches(replace, rules) {
    var lcString = replace.toLowerCase();
    return Object.keys(rules).filter(function (result) {
        var items = rules[result];
        return items.some(function (item) {
            return (lcString.indexOf(item.toLowerCase()) !== -1);
        });
    });
}
function fixProps(props) {
    var out = props;
    var date = props["Date"].trim();
    var split = date.split(" ");
    if (split[2] === "")
        split.splice(2, 1);
    var time = split[2] + " " + split[3];
    props["Date"] = split[0] + " " + split[1];
    props["Time"] = time;
    var location = props["Location"];
    split = location.split(", ");
    props["District"] = split[0];
    props["City"] = split[1];
    if (props["Mileage"])
        props["Mileage"] = props["Mileage"].replace("km", "");
    if (props["Engine capacity"])
        props["Engine capacity"] = props["Engine capacity"].replace("cc", "");
    if (props["Brand"] && props["Model"]) {
        for (var brand in replaceList) {
            if (brand.toLowerCase().indexOf(props["Brand"].toLowerCase()) !== -1) {
                var repl = findMatches(props["Model"], replaceList[brand]);
                if (repl.length > 0) {
                    props["Model"] = repl[0];
                }
                break;
            }
        }
    }
    return out;
}
function exportToCsv(file, onlyCars) {
    var ws = {};
    var range = { s: { c: 1000000, r: 1000000 }, e: { c: 0, r: 0 } };
    var headers = ["Date", "Time", "Brand", "Model", "Model year", "Engine capacity", "Mileage", "Price", "Transmission", "Body type", "Fuel type", "Contact no", "District", "City", "Title", "Owner", "URL"];
    for (var c = 0; c < headers.length; c++) {
        var r = 0;
        var cell = { v: headers[c], t: "s" };
        if (!cell)
            continue;
        var cell_ref = xlsx.utils.encode_cell({ c: c, r: r });
        ws[cell_ref] = cell;
    }
    db.all("SELECT * FROM cars;", function (err, rows) {
        if (!rows)
            return;
        var row_offset = 0;
        for (var r = 1; r < rows.length; r++) {
            var c = -1; // first one starts at 0
            if (rows[r - 1]["cars"] !== "Cars" && onlyCars) {
                row_offset++;
                continue;
            }
            //filter out 'null' models
            if (typeof rows[r - 1]["model"] === "object") {
                row_offset++;
                continue;
            }
            for (var key in rows[r - 1]) {
                c++;
                if (range.s.r > r)
                    range.s.r = r;
                if (range.s.c > c)
                    range.s.c = c;
                if (range.e.c < c)
                    range.e.c = c;
                if (range.e.r < r)
                    range.e.r = r;
                var cell = { v: rows[r - 1][key], t: "s" };
                if (!cell)
                    continue;
                var cell_ref = xlsx.utils.encode_cell({ c: c, r: r - row_offset });
                ws[cell_ref] = cell;
            }
        }
        range.s.r = 0;
        range.s.c = 0;
        if (range.s.c < 1000000)
            ws["!ref"] = xlsx.utils.encode_range(range.s, range.e);
        var out = xlsx.utils.sheet_to_csv(ws);
        fs.writeFile(file, out);
        console.log("File writing finished!");
    });
}
function insertIntoDatabase(obj) {
    db.all("SELECT * FROM cars WHERE url=?", obj.URL, function (err, rows) {
        if (!rows)
            rows = [];
        if (rows.length == 0) {
            console.log("URL not present!", obj.URL, err);
            db.run("INSERT INTO cars(date, time, brand, model, model_year, engine_capacity, mileage, price, transmission, body_type, fuel, number, district, city, title, owner, url, cars) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", obj.Date, obj.Time, obj.Brand, obj.Model, obj["Model year"], obj["Engine capacity"], obj.Mileage, obj.Price, obj.Transmission, obj["Body type"], obj["Fuel type"], obj.Number, obj.District, obj.City, obj.Title, obj.Owner, obj.URL, obj.Cars, function (err) {
                if (err) {
                    console.error(err);
                }
            });
        }
        if (err) {
            console.error(err);
        }
    });
}
scrapeList("http://ikman.lk/en/ads/cars-vehicles-in-sri-lanka-391");
        exportToCsv("./cars.csv", true);
        exportToCsv("./all.csv", true);
        fs.writeFile('output.json', JSON.stringify(parsedResults, null, 4), function(err){
              console.log('File successfully written! - Check your project directory for the output.json file');
            })
setInterval(function() {
        scrapeList("http://ikman.lk/en/ads/cars-vehicles-in-sri-lanka-391");
        exportToCsv("./cars.csv", true);
        exportToCsv("./all.csv", true);
        fs.writeFile('output.json', JSON.stringify(parsedResults, null, 4), function(err){
              console.log('File successfully written! - Check your project directory for the output.json file');
            })
    }, 15000);
app.listen('8081')
console.log('Magic happens on port 8081');