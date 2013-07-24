var Base = require('./base'),
    exec = require('child_process').exec,
    log4js = require('log4js'),
    logger = log4js.getLogger(),
    mac = require('getmac'),
    optimist = require('optimist'),
    os   = require('os'),
    util = require('util'),
    myArgs = optimist
    .usage('MQTT System Agent\nUsage: $0')
    .alias({
        'c': 'configFile',
    })
    .describe({
        'c': 'Configuration file',
        'help': 'Show this help'
    })
    .argv;

function Agent(config) {
    Base.call(this);
    var self = this;
    this.config = config;
    this.haveConnected = false;
    this.state = Agent.Disconnected;
    mac.getMac(function(err, macAddress) {
        if (err) throw err;
        self.macAddress = macAddress;
        self.id = self.config.id || (self.config.useMacAsId && macAddress || os.hostname());
        self.topicRoot = util.format("/%s/%s", config.topicRoot, self.id);
        self.systemTopic = util.format("%s/systemInfo", self.topicRoot);
    });
}

util.inherits(Agent, Base);

Agent.prototype.handleConnect = function() {
    this.registerWithMonitor();
    this.subscribeToReregister();
    this.publishOSInfo();
    this.publishSystemInfo();
}

Agent.prototype.handleMessage = function(topic, message, packet) {
    if (topic == this.reregisterTopic) {
        this.registerWithMonitor();
    }
}

Agent.prototype.getDiskSpace = function(callback) {
    if (os.type() == 'Darwin' || os.type() == 'Linux') {
        exec('df -k', function(err, stdout, stderr) {
            if (err) {
                logger.error("Error getting disk info: %s", stderr);
                callback(null);
                return;
            }
            var lines = stdout.split('\n'),
                keys = lines[0].split(/ +/),
                ret = [];
            for (var i = 1; i < lines.length; ++i) {
                var values = lines[i].split(/ +/);
                var fs = {}
                keys.forEach(function (element, index, array) {
                    fs[element] = values[index];
                });
                ret.push(fs);
            };
            callback(ret);
        });
    } else {
        callback(null);
    }
}

Agent.prototype.registerWithMonitor = function() {
    var data = {
        id: this.id,
        publishInterval: this.config.publishInterval,
        systemTopic: this.systemTopic,
    }
    var topic = util.format("/%s/register", this.config.topicRoot);
    this.logger.info("Publishing registration to %s", topic);
    this.client.publish(topic, JSON.stringify(data));
}

Agent.prototype.subscribeToReregister = function() {
    this.reregisterTopic = util.format("/%s/reregister", this.config.topicRoot);
    this.client.subscribe(this.reregisterTopic);
}

Agent.prototype.publishOSInfo = function() {
    var osInfo = {};
    osInfo.hostname = os.hostname();
    osInfo.type = os.type();
    osInfo.platform = os.platform();
    osInfo.arch = os.arch();
    osInfo.release = os.release();
    osInfo.macAddress = this.macAddress;
    var topic = util.format("%s/osInfo", this.topicRoot);
    this.logger.info("Publishing osInfo to %s", topic);
    this.client.publish(topic, JSON.stringify(osInfo), {retain: true});
}

Agent.prototype.publishSystemInfo = function() {
    var self = this,
        info = {};
    this.timer = setInterval(function() {
        info.uptime = os.uptime();
        info.loadavg = os.loadavg();
        info.totalmem = os.totalmem();
        info.freemem = os.freemem();
        info.cpus = os.cpus();

        self.getDiskSpace(function(values) {
            if (values) info.disk = values;
            self.logger.info("Publishing systemInfo to %s", self.systemTopic);
            self.client.publish(self.systemTopic, JSON.stringify(info));
        });
    }, this.config.publishInterval);
}

if (myArgs.c || myArgs.configFile) {
    var configFile = myArgs.c || myArgs.configFile;
    var defaults = {
        host: 'localhost',
        port: 1883,
        topicRoot: 'monitoring',
        publishInterval: 5000,
        reconnectInterval: 5000,
        useMacAsId: false
    };
    Base.readConfig(configFile, defaults, function(err, config) {
        Base.logger.info("Reading configuration from %s", configFile);
        if (err) {
            Base.logger.info("Error reading config file %s: %s", configFile, err);
            process.exit(-1);
        }
        var agent = new Agent(config);
        agent.connect();
    });
} else {
    Base.logger.error("No config file specified, exiting");
    process.exit(-1);
}
