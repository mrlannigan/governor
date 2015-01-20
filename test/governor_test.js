'use strict';

/*jshint expr:true, unused:false */

var Lab = require('lab'),
    lab = exports.lab = Lab.script(),
    describe = lab.describe,
    it = lab.it,
    before = lab.before,
    BPromise = require('bluebird'),
    Bunyan = require('bunyan'),
    Application = require('../lib/application'),
    log = require('../lib/log');

describe('governor', function () {

    it('should create a governor', function (done) {
        var ok = createServer({
            priority: 1,
            nodeHostname: '127.0.0.1',
            port: 8080,
            n: 'testhost1',
            nodes: ['localhost:8080']
        });

        ok = ok.then(function (app) {
            app.should.exist;
            return app.close();
        });

        ok.done(done, done);
    });

    it('should create a couple governors', function (done) {
        var ok = createServers(2);

        ok = ok.then(function (apps) {
            apps.should.have.lengthOf(2);
            return BPromise.each(apps, function (app) {
                app.close();
            });
        });

        ok.delay(100);

        ok.done(function () {
            done();
        }, function () {
            done();
        });
    });

    it('should respond to send-shared-state', function (done) {

        var ok = createServers(2);

        ok = ok.delay(100); // wait a second for elections to finish

        ok = ok.then(function (apps) {
            var prom;

            apps.should.have.lengthOf(2);

            apps[0].state.isMaster.should.be.true;
            apps[1].state.isMaster.should.be.false;

            prom = apps[1].state.cluster[0].emitPromise('send-shared-state').then(function (data) {
                data.should.have.property('version', 0);
                data.should.have.property('locks');
            });

            prom = prom.then(function () {
                BPromise.each(apps, function (app) {
                    app.close();
                });
            });

            return prom;
        });

        ok.done(done, done);
    });

    it('should handle cluster-place-locks to update lock state', function (done) {
        var ok = createServers(2);

        ok = ok.delay(100); // wait a second for elections to finish

        ok = ok.then(function (apps) {
            var main, backup,
                lockData = [{key: 'testlock', locking: true}],
                date = Date.now(),
                prom;

            apps.should.have.lengthOf(2);

            main = apps[0];
            backup = apps[1];

            main.state.isMaster.should.be.true;
            backup.state.isMaster.should.be.false;

            main.state.shared.version = 1;
            main.state.shared.locks = {'testlock': date};

            prom = main.state.cluster[0].emitPromise('cluster-place-locks', lockData, date, main.state.shared.version);

            prom = prom.then(function () {
                backup.state.shared.should.have.property('version', 1);
                backup.state.shared.should.have.property('locks');
                backup.state.shared.locks.should.have.property('testlock', date);
            });

            prom = prom.then(function () {
                BPromise.each(apps, function (app) {
                    app.close();
                });
            });

            return prom;
        });

        ok.done(done, done);
    });

    it('should sync if it gets out of step with master', function (done) {
        var ok = createServers(2);

        ok = ok.delay(100); // wait a bit for elections to finish

        ok = ok.then(function (apps) {
            var main, backup,
                lockData = [{key: 'testlock', locking: true}],
                date = Date.now(),
                prom;

            apps.should.have.lengthOf(2);

            main = apps[0];
            backup = apps[1];

            main.state.isMaster.should.be.true;
            backup.state.isMaster.should.be.false;

            main.state.shared.version = 10;
            main.state.shared.locks = {'testlock': date};

            // the initial state of the backup should be version 0
            backup.state.shared.should.have.property('version', 0);

            prom = main.state.cluster[0].emitPromise('cluster-place-locks', lockData, date, main.state.shared.version);

            // immediately after cluster place locks, the backup shared state should have version 1
            prom = prom.then(function () {
                backup.state.shared.should.have.property('version', 1);
                backup.state.shared.should.have.property('locks');
                backup.state.shared.locks.should.have.property('testlock', date);
            });

            prom = prom.delay(1); // wait a second for the sync to happen

            // then the sync should get fired and its version should get in sync with master
            prom = prom.then(function () {
                backup.state.shared.should.have.property('version', 10);
                backup.state.shared.should.have.property('locks');
                backup.state.shared.locks.should.have.property('testlock', date);
            });

            prom = prom.then(function () {
                BPromise.each(apps, function (app) {
                    app.close();
                });
            });

            return prom;

        });

        ok.done(done, done);
    });

});


function createServers(count) {
    var portindex = 0,
        nameindex = 0,
        proms = [],
        nodes = [],
        priority = count;

    while (portindex < count) {
        nodes.push('localhost:808' + portindex++);
    }

    while (nameindex < count) {

        proms.push(createServer({
            priority: priority--,
            nodeHostname: '127.0.0.1',
            port: 8080 + nameindex,
            n: 'testhost' + nameindex++,
            nodes: nodes
        }));
    }

    return BPromise.all(proms);
}


function createServer(args) {

    var logger = Bunyan.createLogger({
            name: 'governor',
            streams: [{
                stream: process.stdout,
                level: Bunyan.ERROR
            }],
            serializers: log.serializers
        }),
        startupLogger = logger.child({startup: true})


    var app = new Application();
    app.setArguments(args)
        .setLogger(logger, startupLogger)
        .setNodeName(args.n);

    return app.listen().then(function () {
        logger.info('application listening');

        return BPromise.resolve()
            .delay(500)
            .then(function () {
                app.beginElection();
            })
            .catch(BPromise.CancellationError, function () {
                logger.err('already found elected master');
            })
            .then(function () {
                return app;
            });

    }).catch(function (err) {
        startupLogger.info({err: err}, 'application failed to listen');
    });

    process.on('SIGTERM', function () {
        logger.error('received SIGTERM, closing server connections');
        app.close().finally(function () {
            logger.error('closed server');
            process.exit(0);
        });
    });

    process.on('SIGINT', function () {
        logger.error('received SIGINT, closing server connections');
        app.close().finally(function () {
            logger.error('closed server');
            process.exit(0);
        });
    });
}