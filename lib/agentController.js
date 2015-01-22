'use strict';

var baseController = require('./baseController'),
    agentController = Object.create(baseController),
    BPromise = require('bluebird');

module.exports = agentController;


/**
 *
 */



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
    socket.onPromise('handle-locks', function (options) {
        return BPromise.try(function () {
            var status, ok;

            if (!options.date) {
                options.date = Date.now();
            }

            status = server.app.state.handleLocks(options.lock_data, options.date);

            if (status.updated) {
                ok = server.app.state.clusterEmit('cluster-place-locks', options.lock_data, options.date, status.version);

                ok.then(function () {
                    if (status.ok) {
                        self.startJob(options.agent_name, options.job_name);
                    }
                    return status;
                }, function (err) {
                    socketLogger.info('error in cluster place locks event', err);
                    return status;
                });

                return ok;
            }

            return status;
        });
    });

    //ToDo: organize these jobs by agent
    socket.onPromise('register-job', function (jobname, agentname) {

        // job tracking
        self.registerJob(jobname);

        // this method checks if the agent is registered, and if not, registers it
        self.registerAgent(agentname);

        // agent - job tracking
        self.registerAgentJob(agentname, jobname);

        return server.app.state.clusterEmit('cluster-register-job', agentname, jobname);


    });

    socket.onPromise('job-start', function (agentname, jobname) {
        self.startJob(agentname, jobname);
        return server.app.state.clusterEmit('cluster-start-job', agentname, jobname);
    });
};