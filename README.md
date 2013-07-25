# mqttOsMonitor
OS monitoring system using [Node.js](http://nodejs.org/) and [MQTT](http://mqtt.org/). The system is divided into two parts - the Monitor and the Agents. The agents run on the systems to be monitored, and publish OS information such as OS name and type, uptime, CPU utilization and disk space usage. These statistics are published to an MQTT server. The agents also use MQTT to register with the monitor, which is responsible for determining whether the systems are available or not based on the data published by the agents.

## Agents
The agent is run using the following command:

    $ node mqttOsAgent.js [-c config-file]

You can give it a JSON-formatted configuration file, or let it use its defaults (see section on Configuration, below).
It identifies itself, by default, using the hostname. You can override this with either the `useMacAsId` parameter, in which case it will attempt to use the MAC address of the machine, or you can specify an ID in the configuration file.

When it starts up, it attempts to register with whatever monitors are listening by publishing some information to a well-known topic, by default `/monitoring/register`. The information it publishes consists of its ID, its `publishInterval`, which is how often it publishes OS information, and its `systemTopic`, which is the topic on which it publishes the OS information. It also subscribes to a re-register topic, by default `/monitoring/reregister`, which tells it to register again (for instance, if a monitor went down and then came back up).

It then publishes its OS information every `publishInterval` milliseconds (default 5000). Here's an example of the output (truncated somewhat for brevity):

    {
       "hostname":"desktop.geekheads.private",
       "type":"Darwin",
       "platform":"darwin",
       "arch":"x64",
       "release":"12.4.0",
       "uptime":607933,
       "loadavg":[
          1.27587890625,
          1.25341796875,
          1.22412109375
       ],
       "totalmem":8589934592,
       "freemem":1569271808,
       "cpus":[
          {
             "model":"Intel(R) Core(TM) i7-2635QM CPU @ 2.00GHz",
             "speed":2000,
             "times":{
                "user":56364830,
                "nice":0,
                "sys":36697460,
                "idle":514855220,
                "irq":0
             }
          },
          {
             "model":"Intel(R) Core(TM) i7-2635QM CPU @ 2.00GHz",
             "speed":2000,
             "times":{
                "user":3523910,
                "nice":0,
                "sys":1466810,
                "idle":602926640,
                "irq":0
             }
          },
          {
             "model":"Intel(R) Core(TM) i7-2635QM CPU @ 2.00GHz",
             "speed":2000,
             "times":{
                "user":54540300,
                "nice":0,
                "sys":21754930,
                "idle":531622140,
                "irq":0
             }
          },
          {
             "model":"Intel(R) Core(TM) i7-2635QM CPU @ 2.00GHz",
             "speed":2000,
             "times":{
                "user":3674380,
                "nice":0,
                "sys":1358210,
                "idle":602884780,
                "irq":0
             }
          }
       "disk":[
          {
             "Filesystem":"/dev/disk1s2",
             "1024-blocks":"487546976",
             "Used":"210267620",
             "Available":"277023356",
             "Capacity":"44%",
             "iused":"52630903",
             "ifree":"69255839",
             "%iused":"43%",
             "Mounted":"/"
          },
          {
             "Filesystem":"/dev/disk0s2",
             "1024-blocks":"488050672",
             "Used":"359519612",
             "Available":"128531060",
             "Capacity":"74%",
             "iused":"89879901",
             "ifree":"32132765",
             "%iused":"74%",
             "Mounted":"/Volumes/Macintosh",
             "on":"HD2"
          },
          {
             "Filesystem":"/dev/disk2s1",
             "1024-blocks":"149960",
             "Used":"84496",
             "Available":"65464",
             "Capacity":"57%",
             "iused":"21122",
             "ifree":"16366",
             "%iused":"56%",
             "Mounted":"/Volumes/Leap",
             "on":"Motion"
          }
       ]
    }

### Configuration
The agent configuration file is a JSON-formatted file consisting of the following pieces of information:

* `id` - The ID of the agent. This can be anything, but it should be unique within the context of a given monitor instance. If not specified, it will attempt to use either the hostname or, if `useMacAsId` is `true`, use the MAC address.
* `host` - the hostname of the machine running the MQTT server (default 'localhost')
* `port` - the port of the MQTT server (default 1833)
* `topicRoot` - the base string for all the topics for this agent. The default is 'monitoring', which means that all topics start with `/monitoring`.
* `publishInterval` - how often, in milliseconds, it publishes its OS information (default 5000)
* `reconnectInterval` - if it loses its connection to the MQTT server, it attempts to reconnect. This is how often it attempts to reconnect, in milliseconds. Default is 5000.
* `useMacAsId` - use the MAC address as the ID instead of the hostname. Default is `false`.
* `log4js` - a substructure containing configuration for the [log4js](https://github.com/nomiddlename/log4js-node) system, which the agent uses for logging.

An example of a configuration file:

    {
        "id": "Raspberry Pi",
        "host": "mqttHost",
        "publishInterval": 10000
    }

## Monitor
The monitor is started by running the following command:

    $ node mqttOsMonitor.js [-c config-file]

As with the agent, you can specify a JSON-formatted configuration file on the command line (see Configuration, below).

The monitor is responsible for determining if a given device/host is up or not. It does this by listening for the data published on MQTT by the agent (or anything else running on the device) as a sort of "heartbeat". The way it indicates whether a given device is up or not is by publishing either `true` or `false` to a well-known topic, by default `/monitoring/`_deviceId_`/isUp`. MQTT clients can then get information on what devices are available by subscribing to `/monitoring/+/isUp`.

The monitor monitors two ways devices register with the monitor - statically and dynamically. Dynamically-registered devices are ones with agents running on them - they are referred to as 'dynamic' because the monitor doesn't have to know about them ahead of time, due to the registration process (see Registration, below). Statically-registered devices are devices whose information is hardcoded in the monitor's configuration file. This is primarily for devices which publish information regularly, but which, for whatever reason, no agent can be run on - for example, a sensor which doesn't run any of the standard operating systems, but which does publish data regularly.

### Registration
When an agent starts up, it immediately publishes a registration message consisting of its ID, publishing interval and publishing topic, to the registration topic, by default `/monitoring/register`. The monitor, which subscribes to this topic on startup, then registers the device and listens to its publishing topic for messages. It also marks the device as being available by setting `/monitoring/`_deviceId_`/isUp` to `true`. It publishes this value with the 'retain' flag set to true, so the value persists, and new subscribers can get the current value when they subscribe.

When the agent stops publishing on the topic for more than a certain number of publishing cycles, the monitor changes the device's `isUp` value to `false`, until it hears from it again.

To handle the case where, for whatever reason, a monitor goes down and then comes back up, the monitor, on startup, publishes to a re-registration topic, by default `/monitoring/reregister`, which agents are listening to. When the agents see a message on that topic, they immediately resend their registration, which the monitor receives.

### Static Registration
Devices which cannot register by the usual method may be registered manually with the monitor by putting the same information that they would normally publish as part of registration into the configuration file (see below).

### Configuration
The configuration file for the monitor is similar to that of the agent - it is a JSON-formatted file consisting of the following values:

* `host` - the hostname of the machine the MQTT server is running on (default 'localhost').
* `port` - the port MQTT is listening on (default 1883).
* `topicRoot` - the top-level string for the topics (default 'monitoring')
* `checkInterval` - how often, in milliseconds, the monitor checks its clients to see if they are up or not (default 10000).
* `clients` - this is an array of registration data for devices which need to be statically configured

An example configuration file:

    {
        "host": "mqttHost",
        "checkInterval": 5000,
        "clients": [
            {
                "id": "temperature Sensor",
                "publishInterval": 15000,
                "topic": "/home/master bedroom/temperature"
            },
            {
                "id": "humidity Sensor",
                "publishInterval": 10000,
                "topic": "/home/wine cellar/humidity"
            }
        ]
    }
