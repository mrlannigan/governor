'use strict';

/*jshint expr:true, unused:false */

var Lab = require('lab'),
    lab = exports.lab = Lab.script(),
    describe = lab.describe,
    it = lab.it,
    BPromise = require('bluebird'),
    utils = require('./test_utils');



describe('governor', function () {

    it('should create a governor', function (done) {
        var ok = utils.createServer({
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

        ok.done(function () {
            done();
        }, done);
    });

    it('should create a couple governors', function (done) {
        var ok = utils.createServers(2);

        ok = ok.then(function (apps) {
            apps.should.have.lengthOf(2);
            apps[0].state.cluster.should.have.lengthOf(1);
            return BPromise.each(apps, function (app) {
                app.close();
            });
        });

        ok.done(function () {
            done();
        }, done);
    });

    it('should respond to send-shared-state', function (done) {

        var ok = utils.createServers(2);

        ok = ok.delay(100); // wait a moment for elections to finish

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

        ok.done(function () {
            done();
        }, done);
    });



});

