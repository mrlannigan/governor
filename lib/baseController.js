'use strict';

var baseController = {};

module.exports = baseController;

baseController.init = function (logger, server) {
    this.logger = logger;
    this.server = server;
}

/**
 * if an agentName is not already registered in the agents state object, it is added
 *
 * @param agentname {string}
 * @returns {object} - returns the agent state object
 */
baseController.registerAgent = function (agentname) {
    var agents = this.server.app.state.agents;

    if (!agents[agentname]) {
        agents[agentname] = {
            jobs: {},
            active_jobs: {}
        };
        this.server.app.state.clusterEmit('cluster-identify-agent', agentname);
    }

    return agents[agentname];
};

/**
 * sets up tracking structure for a particular job type
 * @param {string} jobname
 */
baseController.registerJob = function (jobname) {
    var jobs = this.server.app.state.jobs;

    if (!jobs[jobname]) {
        jobs[jobname] = {
            active_jobs: {},
            stats: {
                count: 0,
                avg_response_time: 0
            }
        };
    }

    return jobs;
};
