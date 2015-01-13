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

/**
 * Setter to apply node name
 * @param name
 */
State.prototype.setNodeName = function (name) {
    this.nodeName = name;
};

/**
 * Identify current node
 * @returns {Object}
 */
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

/**
 * Returns a sorted array of connected nodes
 * @returns {Array}
 */
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

/**
 * Sort node array
 * @param nodes
 * @returns {Array.<T>}
 */
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

/**
 * Demote current node to a priority of zero
 */
State.prototype.demote = function () {
    var _master = this.isMaster;
    this.priority = 0;

    this.isMaster = false;
    if (this.currentMaster == this.nodeName) {
        this.currentMaster = null;
    }

    return _master;
};

/**
 * Promote current node to a priority higher than the highest plus one
 * Otherwise, do nothing because current node is already the highest
 */
State.prototype.promote = function () {
    var highestPriority = 0,
        _master = this.isMaster;

    highestPriority = this.cluster.reduce(function (prev, client) {
        return prev > client.priority ? prev : client.priority;
    }, highestPriority);

    if (highestPriority >= this.priority) {
        this.priority = 1 + highestPriority;
    }

    return _master;
};

State.prototype.getMasterClient = function () {
    if (this.isMaster) {
        // we are the master; you shouldn't call this; wouldn't return the same API
        return false;
    }

    return this.cluster.filter(function (client) {
        return client.isMaster;
    });
};

module.exports = State;