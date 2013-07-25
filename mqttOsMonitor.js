var Base = require('./base'),
    mac = require('getmac'),
    optimist = require('optimist'),
    os = require('os'),
    util = require('util'),
    myArgs = optimist
    .usage('MQTT System Monitor\nUsage: $0')
    .alias({
        'c': 'configFile',
        'h': 'help'
    })
    .describe({
        'c': 'Configuration file',
        'help': 'Show this help'
    })
    .demand('c')
    .argv;

if (myArgs.help) {
    optimist.showHelp();
    process.exit(0);
}

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
            client.availableTopic = getAvailableTopic(client.id);
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

Monitor.prototype.getAvailableTopic = function(id) {
    return util.format("/%s/%s/isUp", this.config.topicRoot, id);
}

Monitor.prototype.handleRegistration = function(topic, message) {
    var clientData = JSON.parse(message);
    clientData.lastUpdate = this.getTimestamp();
    clientData.availableTopic = this.getAvailableTopic(clientData.id);
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
        if (Object.keys(clientData).indexOf(name) == -1) {
            if (name != 'id') {
                this.logger.error("Error - registration for %s doesn't contain a %s", clientData.id, name);
            } else {
                this.logger.error("Error - registration doesn't contain a %s", name);
            }
        }
    });
}

Monitor.prototype.handleConnect = function() {
    var self = this;
    this.client.subscribe(this.registrationTopic);
    this.client.subscribe(this.getAvailableTopic('+'));
    this.client.publish(util.format("/%s/reregister", this.config.topicRoot), "true");
    this.timer = setInterval(function(self) {
        self.logger.info("Checking clients");
        var timestamp = self.getTimestamp();
        var self = self;
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
    }, this.config.checkInterval, this);
};

Monitor.prototype.getTimestamp = function() {
    return new Date().getTime();
}

Monitor.prototype.isAvailableTopic = function(topic) {
    return topic.match(/isUp$/) == 'isUp';
}

Monitor.prototype.handleMessage = function(topic, message, packet) {
    var self = this;
    if (topic == this.registrationTopic) {
        this.handleRegistration(topic, message);
    } else if (this.isAvailableTopic(topic)) {
        if (message.length > 0) {
            var found = false;
            Object.keys(this.registeredClients).every(function(key) {
                if (self.registeredClients[key].availableTopic == topic) {
                    found = true;
                    return false;
                }
                return true;
            });
            if (!found) {
                this.logger.info("Removing topic %s", topic);
                this.client.publish(topic, null, { retain: true });
            }
        }
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
    Base.logger.error("No config file specified");
    optimist.showHelp();
    process.exit(-1);
}
