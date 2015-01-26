'use strict';

/*jshint expr:true, unused:false */

var Lab = require('lab'),
    lab = exports.lab = Lab.script(),
    describe = lab.describe,
    it = lab.it,
    BPromise = require('bluebird'),
    basecontroller = require('../lib/baseController'),
    utils = require('./test_utils');


describe('agents', function () {
    it('should handle locks', function (done) {

        var ok = utils.createServers(2);

        ok = ok.delay(100); // wait a moment for elections to finish

        ok = ok.then(function (apps) {
            var main, backup,
                date = Date.now(),
                lockData = {
                    agent_name: 'testagent',
                    job_name: 'myjob',
                    lock_data: [{key: 'testlock', locking: true}],
                    date: date
                },
                agentconn = utils.agentConnect();


            apps.should.have.lengthOf(2);

            main = apps[0];
            backup = apps[1];

            main.state.isMaster.should.be.true;
            backup.state.isMaster.should.be.false;


            var prom = agentconn.emitPromise('handle-locks', lockData, date);

            prom = prom.then(function (status) {

                status.should.have.property('ok', true);
                status.should.have.property('updated', true);
                status.should.have.property('lockState', [0]);
                status.should.have.property('version', 1);

                main.state.shared.version = 1;
                main.state.shared.locks = {'testlock': date};

                backup.state.shared.should.have.property('version', 1);
                backup.state.shared.should.have.property('locks');
                backup.state.shared.locks.should.have.property('testlock', date);

                agentconn.close();
                return BPromise.each(apps, function (app) {
                    app.close();
                });
            });

            return prom.then(function () {
                return;
            });
        });

        ok.done(function () {
            done();
        }, done);
    });

    it('should sync if it gets out of step with master', function (done) {
        var ok = utils.createServers(2);

        ok = ok.delay(100); // wait a bit for elections to finish

        ok = ok.then(function (apps) {
            var main, backup,
                date = Date.now(),
                lockData = {
                    agent_name: 'testagent',
                    job_name: 'myjob',
                    lock_data: [{key: 'testlock', locking: true}],
                    date: date
                },
                prom,
                agentconn = utils.agentConnect();

            apps.should.have.lengthOf(2);

            main = apps[0];
            backup = apps[1];

            main.state.isMaster.should.be.true;
            backup.state.isMaster.should.be.false;

            main.state.shared.version = 10;
            main.state.shared.locks = {'someotherkey': date};

            // the initial state of the backup should be version 0
            backup.state.shared.should.have.property('version', 0);

            prom = agentconn.emitPromise('handle-locks', lockData, date);


            //todo: add spy to make sure the sync process is happening

            // then the sync should get fired and its version should get in sync with master
            prom = prom.then(function () {
                backup.state.shared.should.have.property('version', 11);
                backup.state.shared.should.have.property('locks');
                backup.state.shared.locks.should.have.property('someotherkey', date);
                backup.state.shared.locks.should.have.property('testlock', date);
            });

            prom = prom.then(function () {
                agentconn.close();
                BPromise.each(apps, function (app) {
                    app.close();
                });
            });

            return prom;

        });

        ok.done(function () {
            done();
        }, done);
    });

    it('should sync multiple governors', function (done) {
        var ok = utils.createServers(5);

        ok = ok.delay(100); // wait a bit for elections to finish

        ok = ok.then(function (apps) {
            var main,
                date = Date.now(),
                lockData = {
                    agent_name: 'testagent',
                    job_name: 'myjob',
                    lock_data: [{key: 'testlock', locking: true}],
                    date: date
                },
                prom,
                agentconn = utils.agentConnect();

            apps.should.have.lengthOf(5);

            // remove main from the apps array
            main = apps.shift();

            main.state.isMaster.should.be.true;

            apps.forEach(function (app) {
                app.state.isMaster.should.be.false;
            });

            main.state.shared.version = 10;
            main.state.shared.locks = {'someotherlock': date};

            // the initial state of the backup should be version 0
            apps.forEach(function (app) {
                app.state.shared.should.have.property('version', 0);
            });

            prom = agentconn.emitPromise('handle-locks', lockData, date);

            // the backups should sync with master
            prom = prom.then(function () {
                apps.forEach(function (app) {
                    app.state.shared.should.have.property('version', 11);
                    app.state.shared.should.have.property('locks');
                    app.state.shared.locks.should.have.property('testlock', date);
                    app.state.shared.locks.should.have.property('someotherlock', date);
                });
            });

            prom = prom.then(function () {
                main.close();
                agentconn.close();
                BPromise.each(apps, function (app) {
                    app.close();
                });
            });

            return prom;

        });

        ok.done(function () {
            done();
        }, done);
    });

    it('should track job registration', function (done) {
        var ok = utils.createServers(2);

        ok = ok.delay(100);

        ok = ok.then(function (apps) {
            var main = apps[0],
                agentconn = utils.agentConnect(),
                jobname = 'myjob',
                agentname = 'agent1',
                prom = agentconn.emitPromise('identify', agentname);

            main.state.isMaster.should.be.true;

            prom = prom.delay(100);

            prom = prom.then(function () {
                return agentconn.emitPromise('register-job', jobname, agentname);
            });

            return prom.then(function () {
                apps.forEach(function (app) {
                    app.state.jobs.should.have.property('active_jobs', {});
                });

                agentconn.close();
                return BPromise.each(apps, function (app) {
                    app.close();
                });
            });

        });

        ok.done(function () {
            done();
        }, done);
    });

    it('should track job activity', function (done) {
        var ok = utils.createServers(2),
            agentname = 'agent1',
            jobname = 'myjob',
            date = Date.now(),
            lockData = {
                agent_name: agentname,
                job_name: jobname,
                lock_data: [{key: 'testlock', locking: true}],
                date: date
            },

        ok = ok.delay(100);

        ok = ok.then(function (apps) {
            var main = apps[0],
                agentconn = utils.agentConnect(),
                prom;

            main.state.isMaster.should.be.true;

            prom = agentconn.emitPromise('identify', agentname);

            prom = prom.then(function () {
                return agentconn.emitPromise('register-job', jobname, agentname);
            });

            prom = prom.then(function () {
                apps.forEach(function (app) {
                    app.state.jobs.should.have.property('active_jobs', {});
                    app.state.agents[agentname].jobs.should.have.property(jobname);
                });
            });

            prom = prom.then(function () {
                return agentconn.emitPromise('handle-locks', lockData);
            });

            prom = prom.then(function (status) {

                apps.forEach(function (app) {
                    var jobs = app.state.jobs;
                    jobs.active_jobs.should.have.property(status.id);
                });
                lockData.id = status.id;
                return agentconn.emitPromise('job-end', lockData);
            });

            prom = prom.delay(1000);

            prom = prom.then(function () {
                apps.forEach(function (app) {
                    var job = app.state.jobs[jobname],
                        agent = app.state.agents[agentname],
                        agentjob = agent.jobs[jobname];

                    [job, agent, agentjob].forEach(function (stats) {
                        stats.meter.toJSON().should.have.property('count', 1);
                        stats.histogram.toJSON().should.have.property('count', 1);
                    });
                });
            });

            prom = prom.then(function () {
                agentconn.close();
                return BPromise.each(apps, function (app) {
                    app.close();
                });
            });

            return prom;
        });

        ok.done(function () {
            done();
        }, done);
    });
});