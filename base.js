var errno = require('errno'),
    log4js = require('log4js'),
    mqtt = require('mqtt');

function Base() {
	var self = this;
	this.logger = Base.logger;
    this.haveConnected = false;
    this.errorHandler = {}
    this.errorHandler.connect = function() {
        if (!self.haveConnected) process.exit(-1);
    }
    this.errorHandler.getaddrinfo = function() { process.exit(-1); }
}

module.exports = Base;

Base.logger = log4js.getLogger();

['Connecting', 'Connected', 'Disconnected'].forEach(function(state, index) {
    Base.prototype[state] = Base[state] = index;
});

Base.prototype.handleError = function(err) {
    this.logError(err, "MQTT error");
    if (err.syscall) {
        if (this.errorHandler[err.syscall]) {
            this.errorHandler[err.syscall]();
        }
    }
}

Base.prototype.connect = function() {
    var self = this;
    if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
    }
    this.state = Base.Connecting;
    this.client = mqtt.createClient(this.config.port, this.config.host, this.config);

    // Have to do this because the MQTT client hides connect errors, and
    // always tries to reconnect. We want to have our own logic for this.
    this.client.stream.on('error', this.client.emit.bind(this.client, 'error'));
    this.client._reconnect = function() {};

    this.client.on('error', function(err) {
        self.handleError(err);
    });

    this.client.on('close', function() {
        if (self.state == Base.Connected) {
            this.logger.error("Disconnected from MQTT server, reconnecting");
            self.reconnectTimer = setInterval(function() {
                self.connect();
            }, self.config.reconnectInterval);
        }
        self.state = Base.Disconnected;
    });

    this.client.on('connect', function() {
        self.state = Base.Connected;
        self.haveConnected = true;
        if (self.reconnectTimer) clearInterval(self.reconnectTimer);
	    self.logger.info("Connected to MQTT server at %s:%d", self.config.host, self.config.port);
        self.handleConnect();
    });

    this.client.on('message', function(topic, message, packet) {
    	self.handleMessage(topic, message, packet);
    });
}

Base.prototype.handleConnect = function() {
	// Override
}

Base.prototype.handleMessage = function(topic, message, packet) {
	// Override
}

function merge(data, defaults) {
    for (var key in data) {
        defaults[key] = data[key];
    }

    return defaults;
}

Base.readConfig = function(filename, defaults, callback) {
    require('fs').readFile(filename, 'utf8', function(err, data) {
        if (err) {
        	callback(err, null);
        	return;
        }
        callback(null, merge(JSON.parse(data), defaults));
    });
}

function getErrnoDescription(err) {
    if (!err.errno) return undefined;
    if (typeof err.errno == 'number') {
        var e = errno.errno[err.errno];
        if (e) {
            return e.description;
        } else {
            return undefined;
        }
    } else if (typeof err.errno == 'string') {
        for (var e in errno.errno) {
            if (errno.errno[e].code == err.code) {
                return errno.errno[e].description;
            }
        }
        return undefined;
    }
}

Base.prototype.logError = function(err, message) {
    if (err.syscall != undefined) {
        var description = getErrnoDescription(err) || err.code;
        this.logger.error("%s on %s: %s", message, err.syscall, description);
    } else {
        this.logger.error("%s: %s", message, err);
    }
}
