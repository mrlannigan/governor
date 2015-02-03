'use strict';

var crypto = require('crypto'),
    HoekBoom = require('hoek-boom'),
    Measured = require('measured');

module.exports = BaseController;


function BaseController(logger, server) {
    this.logger = logger;
    this.server = server;
}

/**
 * if an agentName is not already registered in the agents state object, it is added
 *
 * @param agentname {string}
 * @returns {object} - returns the agent state object
 */
BaseController.prototype.registerAgent = function (agentname) {
    var agents = this.server.app.state.agents;

    if (!agents[agentname]) {
        agents[agentname] = {
            jobs: {},
            histogram: new Measured.Histogram(),
            meter: new Measured.Meter(),
            timeoutmeter: new Measured.Meter()
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
BaseController.prototype.registerJob = function (jobname) {
    var jobs = this.server.app.state.jobs;

    if (!jobs[jobname]) {
        jobs[jobname] = {
            histogram: new Measured.Histogram(),
            meter: new Measured.Meter(),
            timeoutmeter: new Measured.Meter()
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
BaseController.prototype.registerAgentJob = function (agentname, jobname) {
    var agent = this.registerAgent(agentname);

    if (!agent.jobs[jobname]) {
        agent.jobs[jobname] = {
            histogram: new Measured.Histogram(),
            meter: new Measured.Meter(),
            timeoutmeter: new Measured.Meter()
        };
    }

    return agent;
};

/**
 *
 * @param agentname {string}
 * @param jobname {string}
 * @param date {timestamp}
 * @returns {Promise}
 */
BaseController.prototype.startJob = function (agentname, jobname, date, lockdata, id) {
    var jobs, job;

    id = id || crypto.randomBytes(12).toString('base64').slice(0, 16)
        .replace(/\+/g, '0')
        .replace(/\//g, '0');

    job = {id: id, name: jobname, agent: agentname, start: date, lock_data: lockdata};

    // make sure the agent is registered and tracking this jobtype
    this.registerAgentJob(agentname, jobname);

    // make sure the job is registered for statistics
    jobs = this.registerJob(jobname);

    // put job into active state
    jobs.active_jobs[id] = job;

    return job;
};


/**
 * calculate job duration
 * work out the new job stats
 * remove the job from active jobs
 * @param id
 * @param date
 */
BaseController.prototype.endJob = function (id, date, lockdata, isTimeout) {
    var state = this.server.app.state,
        jobs = state.jobs,
        job = jobs.active_jobs[id],
        agent,
        agentjobinfo,
        duration;

    HoekBoom.assertBoom(job, 'no job was found with this id: ' + id, 'badRequest');

    // stats stuff
    agent = this.server.app.state.agents[job.agent];
    agentjobinfo = agent.jobs[job.name];
    duration = date - job.start;


    if (isTimeout) {
        agent.timeoutmeter.mark();
        jobs[job.name].timeoutmeter.mark();
        agentjobinfo.timeoutmeter.mark();
    } else {
        agent.histogram.update(duration);
        agent.meter.mark();

        agentjobinfo.histogram.update(duration);
        agentjobinfo.meter.mark();

        jobs[job.name].histogram.update(duration);
        jobs[job.name].meter.mark();
    }

    // remove from the active jobs
    delete jobs.active_jobs[id];

    return state.removeLocks(lockdata);


};

BaseController.prototype.computeAverage = function (numcompleted, avgduration, reading) {
    return (numcompleted * avgduration + reading) / ++numcompleted;
};

/**
 *
 * clear all jobs older than maxage
 */
BaseController.prototype.clearOldJobs = function () {
    var state = this.server.app.state,
        activejobs = state.jobs.active_jobs,
        now = Date.now(),
        self = this;

    Object.keys(activejobs).forEach(function (key) {
        var job = activejobs[key],
            duration = now - job.start,
            maxage = job.maxAge || state.jobMaxAge,
            status;

        if (duration > maxage) {
            status = self.endJob(job.id, now, job.lock_data, true);

            return self.server.app.state.clusterEmit('cluster-end-job', job.id, now, job.lock_data, status.version, true)
                .then(function () {
                    return status;
                });
        }
    });
};

BaseController.prototype.clearOldJobsRepeat = function (clearInterval) {
    var interval,
        state = this.server.app.state;

    if (state.isMaster) {
        interval = clearInterval || state.clearOldJobsInterval;
        this.clearOldJobs();
        setTimeout(this.clearOldJobsRepeat.bind(this), interval);
    }
};
