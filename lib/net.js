'use strict';

var os = require('os');

exports.getNetworkAddress = function () {
    var nets = os.networkInterfaces(),
        result = '127.0.0.1';

    Object.keys(nets).some(function (netInterface) {
        var candidate;

        netInterface = nets[netInterface];

        candidate = netInterface.filter(function (item) {
            return item.family === 'IPv4' && !item.internal;
        }).shift();

        if (candidate) {
            result = candidate.address;
            return true;
        }
    });

    return result;
};