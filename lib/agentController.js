'use strict';

var baseController = require('./baseController'),
    agentController = Object.create(baseController);

module.exports = agentController;

/**
 * registers that a particular agent is accepting work for a particular job
 * sets up tracking structure for when the agent starts actually doing work
 *
 * @param {string} agentname
 * @param {string} jobname
 */
agentController.registerAgentJob = function (agentname, jobname) {
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
 */
agentController.startJob = function (agentname, jobname) {
    var agent, jobs,
        job = {name: jobname, start: Date.now()};

    // make sure the agent is registered and tracking this jobtype
    agent = this.registerAgentJob(agentname, jobname);

    // make sure the job is registered for statistics
    jobs = this.registerJob(jobname);


    // put job into active state
    jobs[jobname].active_jobs[jobname] = job;
    // we probably don't need the job in both places, guess we will see
    agent.jobs[jobname].active_jobs[jobname] = job;
    agent.active_jobs[jobname] = job;
};




agentController.initialize = function (logger, socket, server) {
    var self = this,
        socketLogger = logger.child({socket: socket, type: 'agent'});

    socketLogger.info('agent connection made');

    this.init(logger, server);

    socket.on('identify', function (agentname, callback) {
        socketLogger.info(agentname, 'agent identified');
        self.registerAgent(agentname);
        // do we need to wait for the cluster emit to happen before we reply with the callback?
        callback();
    });

    // ToDo: will agents be sending this explicitly, or is this just what happens when the socket is broken?
    socket.on('disconnect', function () {
        // hrm how do we know which one disconnected?
        // we could ping all of the agents and clear out the ones that don't respond?
    });


    /**
     *  this is called when an agent gets a new job.  it verifies that it is allowed to work on it, and sets locks if required
     * @param {object} data
     * @param {string} data.agent_name
     * @param {string} data.job_name
     * @param {array} data.lock_data
     * @param {object} data.lock_data[i]
     * @param {string} data.lock_data[i].key - the locking key, check if this is currently locked
     * @param {boolean} data.lock_data[i].locking - if true, the corresponding key should be locked if all of the keys in the array are currently unlocked
     */
    socket.on('handle-locks', function (data, date, callback) {
        if (typeof date === 'function') {
            callback = date;
            date = Date.now();
        }

        var status = server.app.state.handleLocks(data.lock_data, date);

        if (status.updated) {
            var ok = server.app.state.clusterEmit('cluster-place-locks', data.lock_data, date, status.version);

            ok.then(function () {
                if (status.ok) {
                    self.startJob(data.agent_name, data.job_name);
                }
                callback(status);
            }, function (err) {
                socketLogger.info('error in cluster place locks event', err);
                callback(status);
            });
        } else {
            callback(status);
        }
    });

    //ToDo: organize these jobs by agent
    socket.on('register-job', function (jobname, agentname, callback) {
        var jobs = server.app.state.jobs,
            agents = server.app.state.agents,
            agent = agents[agentname];

        self.registerJob(jobname);

        // this method checks if the agent is registered, and if not, registers it
        self.registerAgent(agentname);

        self.registerAgentJob(agentname, jobname);


        server.app.state.clusterEmit('cluster-register-job', jobname);

        callback();
    });
};