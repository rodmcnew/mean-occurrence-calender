var restify = require('restify');
var server = restify.createServer();
server.use(restify.bodyParser());

// Setup CORS
restify.CORS.ALLOW_HEADERS.push('accept');
restify.CORS.ALLOW_HEADERS.push('sid');
restify.CORS.ALLOW_HEADERS.push('lang');
restify.CORS.ALLOW_HEADERS.push('origin');
restify.CORS.ALLOW_HEADERS.push('withcredentials');
restify.CORS.ALLOW_HEADERS.push('x-requested-with');
server.use(restify.CORS());

var config = require('./config');
var mongoose = require('mongoose/');

var crypto = require('crypto');

// Connect to mongo
mongoose.connect(process.env.MONGOHQ_URL || config.db);

// Create mongoose schema/model
var Schema = mongoose.Schema;
var Calender = mongoose.model(
    'Calender', new Schema({id: String, days: Schema.Types.Mixed})
);

// Static files
server.get('/', restify.serveStatic({
    directory: './public',
    default: 'index.html'
}));
server.get(/\/assets\/?.*/, restify.serveStatic({
    directory: './public/assets'
}));

// Api Routes
server.post('/api/calendars', postCalender);
server.get('/api/calendars/:calenderId', getCalender);
server.get('/api/calendars/:calenderId/days', getDays);
server.get('/api/calendars/:calenderId/days/:dayId', getDay);
server.put('/api/calendars/:calenderId/days/:dayId', putDay);

//Start server
server.listen(process.env.PORT || 80, function () {
        console.log('%s listening at %s', server.name, server.url);
    }
);

function postCalender(req, res, next) {
    makeRandomSecret(function (randomSecret) {
        var calender = new Calender();
        calender.days = {'0-0-0': 0};
        calender.save(function (err, calender) {
            if (!err) {

                var encryptedId = Base64UrlCrypto.encrypt(calender._id.toString(), 'hex');
                calender.id = encryptedId + '~' + randomSecret;

                calender.save(function (err) {
                    if (!err) {
                        res.header('Location', '/api/calendars/' + calender.id);
                        res.send(302);
                    } else {
                        console.error(err);
                        res.send(500);
                    }
                });
            } else {
                console.error(err);
                res.send(500);
            }
        });
    });
}

function getCalender(req, res, next) {
    readCalender(
        req.params.calenderId,
        function (calender) {
            if (calender) {
                res.send(publicizeCalender(calender));
            } else {
                res.send(404);
            }
        }
    )
}

function getDays(req, res, next) {
    queryDays(
        req.params.calenderId,
        function (days) {
            if (days) {
                res.send(days);
            } else {
                res.send(404);
            }
        }
    );
}

function getDay(req, res, next) {
    readCalender(
        req.params.calenderId,
        function (calender) {
            if (calender && validateDay(req.params.dayId)) {
                if (calender.days[req.params.dayId]) {
                    res.send(publicizeDay(req.params.dayId, calender.days[req.params.dayId]))
                } else {
                    res.send(publicizeDay(req.params.dayId, 0));
                }

            } else {
                res.send(404);
            }
        }
    );
}

function putDay(req, res, next) {
    readCalender(
        req.params.calenderId,
        function (calender) {
            if (calender) {
                if (validateDay(req.params.dayId)
                    && validateDayValue(req.params.value)
                    ) {

                    if (req.params.value > 0) {
                        calender.days[req.params.dayId] = req.params.value;
                    } else {
                        delete calender.days[req.params.dayId];
                    }
                    calender.markModified('days');

                    calender.save(function (err, calender) {
                        if (err) {
                            console.log(err);
                        }
                        res.send(publicizeDay(req.params.dayId, req.params.value));
                    });
                } else {
                    res.send(400);
                }
            } else {
                res.send(404);
            }
        }
    );
}

function readCalender(calenderId, callback) {

    var calenderIdParts = calenderId.split('~');
    if (calenderIdParts.length != 2) {
        callback(false);
        return;
    }
    try {
        var mongoId = Base64UrlCrypto.decrypt(calenderIdParts[0], 'hex');
    } catch (e) {
        callback(false);
        return;
    }

    Calender.findById(
        mongoId,
        function (err, calender) {
            if (!err && calender && calender.id == calenderId) {
                callback(calender);
            } else {
                console.error(err);
                callback(false);
            }
        }
    );
}

function queryDays(calenderId, callback) {
    readCalender(
        calenderId,
        function (calender) {
            if (calender) {
                callback(calender.days);
            } else {
                callback(false);
            }
        }
    )
}

function makeRandomSecret(callback) {
    crypto.randomBytes(
        config.randomSecretBytes,
        function (ex, buf) {
            callback(Base64UrlCrypto.base64ToUrlBase64(buf.toString('base64')));
        }
    );
}

function validateDay(day) {
    var dayParts = day.split('-');
    return dayParts.length == 3
        && isFinite(dayParts[0]) && dayParts[0] >= 2000 && dayParts[0] <= 2100
        && isFinite(dayParts[1]) && dayParts[1] >= 0 && dayParts[1] <= 12
        && isFinite(dayParts[2]) && dayParts[2] >= 1 && dayParts[2] <= 31;
}

function validateDayValue(value) {
    return value >= 0 && value <= 3;
}

function publicizeCalender(calender) {
    return {id: calender.id, days: calender.days};
}
function publicizeDay(dayId, value) {
    return {id: dayId, value: value};
}

/*********** BEGIN Base64UrlCrypto ***********/
var Base64UrlCrypto = module.exports = exports;

Base64UrlCrypto.encrypt = function (str, fromEncoding) {
    // init cipher
    var cipher = crypto.createCipher(config.crypto.algo, config.crypto.key);

    // encrypt
    var binary = cipher.update(str, fromEncoding, 'binary') + cipher.final('binary');

    //convert from utf8 to binary
    var base64 = new Buffer(binary, 'binary').toString('base64');

    // replace chars not allowed in urls
    return Base64UrlCrypto.base64ToUrlBase64(base64);
};

Base64UrlCrypto.decrypt = function (urlBase64Str, toEncoding) {
    //init decipher
    var decipher = crypto.createDecipher(config.crypto.algo, config.crypto.key);

    // un-replace chars not allowed in urls
    var base64 = Base64UrlCrypto.baseUrlBase64ToBase64(urlBase64Str);

    // convert from base64 to binary
    var binary = Buffer(base64, 'base64').toString('binary');

    // decrypt
    return decipher.update(binary, 'binary', toEncoding) + decipher.final(toEncoding);
};

Base64UrlCrypto.base64ToUrlBase64 = function (base64Str) {
    return base64Str.replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/g, '');
};

Base64UrlCrypto.baseUrlBase64ToBase64 = function (urlBase64Str) {
    return urlBase64Str.replace(/_/g, '/').replace(/-/g, '+');
};

/*********** END Base64UrlCrypto ***********/