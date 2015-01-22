'use strict';

var baseController = {};

module.exports = baseController;

baseController.init = function (logger, server) {
    this.logger = logger;
    this.server = server;
};

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

// todo: might want to consolidate registerJob and registerAgentJob

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


/**
 * registers that a particular agent is accepting work for a particular job
 * sets up tracking structure for when the agent starts actually doing work
 *
 * @param {string} agentname
 * @param {string} jobname
 */
baseController.registerAgentJob = function (agentname, jobname) {
    var agent = this.registerAgent(agentname);

    if (!agent.jobs[jobname]) {
        agent.jobs[jobname] = {
            completed: 0,
            avg_duration: 0,
            active_jobs: []
        };
    }

    return agent;
};

/**
 *
 * @param agentname
 * @param jobname
 * @returns {Promise}
 */
baseController.startJob = function (agentname, jobname) {
    var agent, jobs,
        job = {name: jobname, start: Date.now()};

    // make sure the agent is registered and tracking this jobtype
    agent = this.registerAgentJob(agentname, jobname);

    // make sure the job is registered for statistics
    jobs = this.registerJob(jobname);


    // put job into active state
    jobs[jobname].active_jobs[jobname] = job;

    // we probably don't need the job in both of these places
    agent.jobs[jobname].active_jobs[jobname] = job;
    agent.active_jobs[jobname] = job;

};