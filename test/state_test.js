'use strict';
/*jshint expr:true, unused:false */

var Lab = require('lab'),
    lab = exports.lab = Lab.script(),
    describe = lab.describe,
    beforeEach = lab.beforeEach,
    it = lab.it,
    expect = Lab.expect,
    should = require('should'),
    State = require('../lib/state'),
    state;

describe('state', function () {

    beforeEach(function (done) {
        state = new State();
        done();
    });

    it('should handle locks', function (done) {
        var status = state.handleLocks([{key: 'testkey'}]);
        status.should.eql({lockState: [0], version: 0, updated: false, ok: true});
        done();
    });

    it('should lock', function (done) {
        var status, status2;
        status = state.handleLocks([{key: 'lockingkey', locking: true}]);
        status.should.eql({lockState: [0], version: 1, updated: true, ok: true});
        status2 = state.handleLocks([{key: 'lockingkey', locking: true}]);
        status2.should.eql({lockState: [1], version: 1, updated: false, ok: false});
        done();
    });

    it('should require lock data', function (done) {
        var status = state.handleLocks();
        status.should.eql({version: 0, ok: false, updated: false});
        done();
    });

    it('should work without any locks', function (done) {
        var status = state.handleLocks([]);
        status.should.eql({lockState: [], version: 0, ok: true, updated: false});
        done();
    });

});
