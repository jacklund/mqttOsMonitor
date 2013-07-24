var Base = require('./base'),
    mac = require('getmac'),
    optimist = require('optimist'),
    os = require('os'),
    util = require('util'),
    myArgs = optimist
    .usage('MQTT System Monitor\nUsage: $0')
    .alias({
        'c': 'configFile',
    })
    .describe({
        'c': 'Configuration file',
        'help': 'Show this help'
    })
    .argv;

function Monitor(config) {
    Base.call(this);
    var self = this;
    this.config = config;
    this.registrationTopic = util.format("/%s/register", config.topicRoot);
    this.registeredClients = {}
    if (this.config.clients) {
        this.config.clients.forEach(function (client, index) {
            if (!client.systemTopic || !client.id) {
                this.logger.error("Configuration error, client has no id or systemTopic set");
                process.exit(-1);
            }
            var topic = client.systemTopic;
            client.fromConfiguration = true;
            client.availableTopic = util.format("/%s/%s/isUp", config.topicRoot, client.id);
            this.registeredClients[topic] = client;
        })
    }
    mac.getMac(function(err, macAddress) {
        if (err) throw err;
        self.macAddress = macAddress;
        self.id = self.config.useMacAsId && macAddress || os.hostname();
    });
}

util.inherits(Monitor, Base);

Monitor.prototype.handleRegistration = function(topic, message) {
    var clientData = JSON.parse(message);
    console.info("Got registration from %s", clientData.id);
    clientData.lastUpdate = this.getTimestamp();
    clientData.availableTopic = util.format("/%s/%s/isUp", this.config.topicRoot, clientData.id);
    this.markClientAvailable(clientData, true);
    this.registeredClients[clientData.systemTopic] = clientData;
    this.client.subscribe(clientData.systemTopic);
}

Monitor.prototype.markClientAvailable = function(clientData, available) {
    if (clientData.markedAsUp != available) {
        this.client.publish(clientData.availableTopic, available.toString(), { retain: true });
        clientData.markedAsUp = available;
    }
}

Monitor.prototype.validateRegistration = function(clientData) {
    ['id', 'systemTopic', 'publishInterval'].forEach(function(name) {
        if (clientData.keys.indexOf(name) == -1) {
            if (name != 'id') {
                this.logger.error("Error - registration for %s doesn't contain a %s", clientData.id, name);
            } else {
                this.logger.error("Error - registration doesn't contain a %s", name);
            }
        }
    });
}

function checkClients(self) {
    self.logger.info("Checking clients");
    var timestamp = self.getTimestamp();
    var values = Object.keys(self.registeredClients).map(function (systemTopic) {
        var clientData = self.registeredClients[systemTopic];
        var diff = timestamp - clientData.lastUpdate;
        if (clientData.markedAsUp) {
            if (diff > 2 * clientData.publishInterval) {
                self.logger.warn("Host %s seems to be down, marking it so", clientData.id);
                self.markClientAvailable(clientData, false);
            }
        }
        if (!clientData.fromConfiguration) {
            if (diff > 5 * clientData.publishInterval) {
                // Remove the client
                delete self.registeredClients[systemTopic];
            }
        }
    });
}

Monitor.prototype.handleConnect = function() {
    this.client.subscribe(this.registrationTopic);
    this.client.publish(util.format("/%s/reregister", this.config.topicRoot), "true");
    this.timer = setInterval(checkClients, this.config.checkInterval, this);
};

Monitor.prototype.getTimestamp = function() {
    return new Date().getTime();
}

Monitor.prototype.handleMessage = function(topic, message, packet) {
    if (topic == this.registrationTopic) {
        this.handleRegistration(topic, message);
    } else {
        var clientData = this.registeredClients[topic];
        if (clientData) {
            if (!clientData.markedAsUp) {
                this.logger.info("Host %s seems to be back up, marking it so", clientData.id);
            }
            clientData.lastUpdate = this.getTimestamp();
            this.markClientAvailable(clientData, true);
        }
    }
}

if (myArgs.c || myArgs.configFile) {
    var configFile = myArgs.c || myArgs.configFile;
    Base.logger.info("Reading configuration from %s", configFile);
    var defaults = {
        host: 'localhost',
        port: 1883,
        topicRoot: 'monitoring',
        checkInterval: 10000
    };
    Base.readConfig(configFile, defaults, function(err, config) {
        if (err) {
            Base.logger.info("Error reading config file %s: %s", configFile, err);
            process.exit(-1);
        }
        var monitor = new Monitor(config);
        monitor.connect();
    });
} else {
    Base.logger.error("No config file specified, exiting");
    process.exit(-1);
}
