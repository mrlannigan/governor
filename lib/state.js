'use strict';

var Emitter = require('events').EventEmitter,
    util = require('util'),
    BPromise = require('bluebird'),
    jobStates = {
        OK: 0,
        LOCKED: 1,
        INVALID: 2
    };

/**
 * @inherits Net
 * @constructor
 */
function State() {
    this.server = null;
    this.agents = {};
    this.cluster = [];
    this.isMaster = false;
    this.priority = 1;
    this.nodeName = null;
    this.nodeHostname = null;
    this.nodePort = null;
    this.serverId = null;
    this.currentMaster = null;
    this.startUpDate = Date.now();
    this.shared = {};
    this.shared.locks = {};
    this.shared.version = 0;
    this.jobs = {
        active_jobs: {}
    };
    this.jobMaxAge = 300000;
    this.clearOldJobsInterval = 60000;
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
    if (this.currentMaster === this.nodeName) {
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

/**
 *
 * throws if there are is no master client, or if there are multiple master clients
 * @returns {governor object}
 */
State.prototype.getMasterClient = function () {
    var master;

    if (this.isMaster) {
        // we are the master; you shouldn't call this; wouldn't return the same API
        return false;
    }

    master = this.cluster.filter(function (client) {
        return client.isMaster;
    });

    if (master.length !== 1) {
        throw new Error('there should be exactly 1 master client, but we got ' + master.length);
    }

    return master[0];
};

State.prototype.versionSharedState = function () {
    // increment the version of the state
    this.shared.version++;
};

/**
 * this is called when a governor finds that its stateVersion is out of sync with masters.
 * it replaces its shared state with masters.
 * @param state
 */
State.prototype.sync = function (state) {
    // could add validation here if needed
    // potential for leaks here, may want to clone this when assigning
    this.shared = state;
};

/**
 * check if any other processes are locking the provided keys.
 * if the provided keys are not locked, ok = true, and go ahead and lock any of the keys that require locking
 * @param lockData [ {key, locking}, {key, locking}]
 * @returns {object} - {lockState: [1, 0, 0 ...], version: 1, updated: false, ok: false}
 */
State.prototype.handleLocks = function (lockData, date, agentname) {
    var self = this,
        status = {},
        locked = false,
        updated = false;

    if (!lockData) {
        return {ok: false, updated: false, version: this.shared.version};
    }

    // check if there are any existing locks that would block this job
    status.lockState = lockData.map(function (lockData) {
        if (self.shared.locks[lockData.key]) {
            locked = true;
            return jobStates.LOCKED;
        } else {
            return jobStates.OK;
        }
    });

    // just calculate the date once, if necessary
    date = date || Date.now();

    // if the job is ok to proceed with, go ahead and set the necessary locks
    if (!locked) {
        lockData.forEach(function (ld) {
            if (ld.locking) {
                self.shared.locks[ld.key] = {date: date, agent: agentname};
                updated = true;
            }
        });
    }


    if (updated) {
        this.versionSharedState();
    }

    status.version = this.shared.version;
    status.updated = updated;
    status.ok = !locked;

    return status;
};

State.prototype.removeLocks = function (lockData) {
    var self = this,
        updated = false,
        status = {};

    lockData.forEach(function (ld) {
        if (ld.locking) {
            delete self.shared.locks[ld.key];
            updated = true;
        }
    });

    if (updated) {
        this.versionSharedState();
    }

    status.version = this.shared.version;
    status.updated = updated;
    return status;
};

/**
 *
 * @returns {Promise}
 */
State.prototype.clusterEmit = function () {
    var args = [],
        argsLength = arguments.length << 0,
        i = 0;

    for (; i < argsLength; i++) {
        args[i] = arguments[i];
    }

    return BPromise.map(this.cluster, function (client) {
        return client.emitPromise.apply(client, args);
    });
};


module.exports = State;
