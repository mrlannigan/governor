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
        var ok = BPromise.all([createServer({
            priority: 1,
            nodeHostname: '127.0.0.1',
            port: 8080,
            n: 'testhost1',
            nodes: ['localhost:8080', 'localhost:8081']
        }),
            createServer({
                priority: 1,
                nodeHostname: '127.0.0.1',
                port: 8081,
                n: 'testhost1',
                nodes: ['localhost:8080', 'localhost:8081']
            })
        ]);

        ok = ok.then(function (apps) {
            apps.should.have.lengthOf(2);
            return BPromise.each(apps, function (app) {
                app.close();
            });
        });

        ok.done(function () {
            done();
        }, function () {
            done();
        });
    });

});


function createServer(args) {

    var logger = Bunyan.createLogger({
            name: 'governor',
            streams: [{
                stream: process.stdout,
                level: Bunyan.INFO
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