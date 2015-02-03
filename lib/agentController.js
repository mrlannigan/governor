'use strict';

var BaseController = require('./baseController'),
    BPromise = require('bluebird'),
    util = require('util');

function AgentController(logfunction, server) {
    AgentController.super_.call(this, logfunction, server);
}

util.inherits(AgentController, BaseController);

module.exports = AgentController;


AgentController.prototype.initialize = function (socket) {
    var logger = this.logger,
        server = this.server,
        self = this,
        socketLogger = logger.child({socket: socket, type: 'agent'});

    socketLogger.info('Agent connection made');

    socket.on('identify', function (agentname, callback) {
        socketLogger.info({agentId: agentname}, 'Agent identified');

        socket.agentname = agentname;
        self.registerAgent(agentname);

        // do we need to wait for the cluster emit to happen before we reply with the callback?
        callback();
    });

    socket.on('disconnect', function () {
        var agentname = socket.agentname;

        socketLogger.info('agent ' + agentname + ' disconnected');
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


        status = server.app.state.handleLocks(options.lock_data, options.date, socket.agentname);

        if (status.updated) {
            ok = server.app.state.clusterEmit('cluster-place-locks', options.lock_data, options.date, socket.agentname, status.version);
        }

        ok = ok.then(function () {
            if (status.ok) {
                job = self.startJob(options.agent_name, options.job_name, options.date, options.lock_data);
                status.id = job.id;
                server.app.state.clusterEmit('cluster-start-job', job);
            }
            return status;
        });

        ok = ok.catch(function (err) {
            // todo: if there was an error, how do we clean up?
            // todo: what if locks were placed?

            socketLogger.info({err: err}, 'Error in handle-locks');
            return status;
        });

        return ok;
    });


    // ToDo: organize these jobs by agent
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

            status = self.endJob(data.id, date, data.lock_data);
            return server.app.state.clusterEmit('cluster-end-job', data.id, date, data.lock_data, status.version)
                .then(function () {
                    return status;
                });
        });
    });
};
