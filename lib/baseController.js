'use strict';

var baseController = {},
    crypto = require('crypto');

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

// todo: might want to consolidate registerJob and registerAgentJob

/**
 * sets up tracking structure for a particular job type
 * @param {string} jobname
 */
baseController.registerJob = function (jobname) {
    var jobs = this.server.app.state.jobs;

    if (!jobs[jobname]) {
        jobs[jobname] = {
            completed: 0,
            avg_duration: 0
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
            avg_duration: 0
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
baseController.startJob = function (agentname, jobname, date, id) {
    var jobs, job;
    id = id || crypto.randomBytes(12).toString('base64').slice(0, 16)
        .replace(/\+/g, '0')
        .replace(/\//g, '0');

    job = {id: id, name: jobname, agent: agentname, start: date};

    // make sure the agent is registered and tracking this jobtype
    this.registerAgentJob(agentname, jobname);

    // make sure the job is registered for statistics
    jobs = this.registerJob(jobname);

    // put job into active state
    jobs.active_jobs[id] = job;

    return job
};


/**
 * calculate job duration
 * work out the new job stats
 * remove the job from active jobs
 * @param id
 * @param date
 */
baseController.endJob = function (id, date) {
    var jobs = this.server.app.state.jobs,
        job = jobs.active_jobs[id],
        agentjobinfo = this.server.app.state.agents[job.agent].jobs[job.name],
        duration = date - job.start;

    agentjobinfo.avg_duration = this.computeAverage(agentjobinfo.completed, agentjobinfo.avg_duration, duration);
    agentjobinfo.completed++;

    jobs[job.name].avg_duration = this.computeAverage(jobs[job.name].completed, jobs[job.name].avg_duration, duration);
    jobs[job.name].completed++;

    delete jobs.active_jobs[id];
};

baseController.computeAverage = function (numcompleted, avgduration, reading) {
    return (numcompleted * avgduration + reading) / ++numcompleted
};