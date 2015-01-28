'use strict';

var baseController = require('./baseController'),
    agentController = Object.create(baseController),
    BPromise = require('bluebird');

module.exports = agentController;

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
        var status, job,
            ok = BPromise.resolve();

        if (!options.date) {
            options.date = Date.now();
        }

        status = server.app.state.handleLocks(options.lock_data, options.date);

        if (status.updated) {
            ok = server.app.state.clusterEmit('cluster-place-locks', options.lock_data, options.date, status.version);
        }

        ok = ok.then(function () {
            if (status.ok) {
                job = self.startJob(options.agent_name, options.job_name, options.date);
                status.id = job.id;
                server.app.state.clusterEmit('cluster-start-job', job);
            }
            return status;
        });

        ok = ok.catch(function (err) {
            // todo: if there was an error, how do we clean up?
            // todo: what if locks were placed?

            socketLogger.info('error in handle-locks', err);
            return status;
        });

        return ok;
    });


//ToDo: organize these jobs by agent
    socket.onPromise('register-job', function (jobname, agentname) {
        // job tracking
        self.registerJob(jobname);
        // this method checks if the agent is registered, and if not, registers it
        self.registerAgent(agentname);
        // agent/job tracking
        self.registerAgentJob(agentname, jobname);

        return server.app.state.clusterEmit('cluster-register-job', agentname, jobname);
    });

    socket.onPromise('job-end', function (data) {
        return BPromise.try(function () {
            var date = Date.now(),
                status;

            self.endJob(data.id, date);
            status = server.app.state.removeLocks(data.lock_data);
            return server.app.state.clusterEmit('cluster-end-job', data.id, date, data.lock_data, status.version)
                .then(function () {
                    return status;
                });
        });
    });
};