'use strict';

var Emitter = require('events').EventEmitter,
    util = require('util');

/**
 * @inherits Net
 * @constructor
 */
function State () {
    this.server = null;
    this.agents = [];
    this.cluster = [];
    this.isMaster = false;
    this.priority = 1;
    this.nodeName = null;
    this.nodeHostname = null;
    this.nodePort = null;
    this.serverId = null;
    this.currentMaster = null;
    this.startUpDate = Date.now();
}

util.inherits(State, Emitter);

State.prototype.setNodeName = function (name) {
    this.nodeName = name;
};

State.prototype.identifyMe = function () {
    var result = {};

    result.priority = this.priority;
    result.uptime = process.uptime();
    result.nodeName = this.nodeName;
    result.nodeHostname = this.nodeHostname;
    result.nodePort = this.nodePort;
    result.isMaster = this.isMaster;
    result.serverId = this.serverId;
    result.startUpDate = this.startUpDate;

    return result;
};

State.prototype.getNodeList = function () {
    var nodes = [];

    nodes = nodes.concat(this.cluster);

    nodes = nodes.filter(function (client) {
        return client.connected;
    });

    nodes.push(this.identifyMe());

    nodes = this.sortClusterList(nodes);

    return nodes;
};

State.prototype.sortClusterList = function (nodes) {
    return nodes.sort(function (clientA, clientB) {
        // isMaster > priority > startUpDate > serverId
        // higher priority means more preference to become master

        if (clientA.isMaster) {
            return -1;
        }

        if (clientB.isMaster) {
            return 1;
        }

        if (clientA.priority > clientB.priority) {
            return -1;
        } else if (clientA.priority < clientB.priority) {
            return 1;
        } else {
            if (clientA.startUpDate < clientB.startUpDate) {
                return -1;
            } else if (clientA.startUpDate > clientB.startUpDate) {
                return 1;
            } else {
                if (clientA.serverId < clientB.serverId) {
                    return -1;
                } else {
                    return 1;
                }
            }
        }
    });
};

module.exports = State;