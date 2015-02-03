'use strict';

var Bunyan = require('bunyan'),
    Hoek = require('hoek-boom');

exports.serializers = {};

exports.serializers.socket = function (socket) {
    if (!socket.conn) {
        return socket;
    }

    var result = {
        remoteAddress: socket.conn.remoteAddress,
        id: socket.conn.id
    };

    if (socket.name) {
        result.name = socket.name;
    }
    if (socket.priority) {
        result.priority = socket.priority;
    }
    if (socket.uptime) {
        result.uptime = socket.uptime;
    }
    if (socket.nodeName) {
        result.nodeName = socket.nodeName;
    }
    if (socket.isMaster) {
        result.isMaster = socket.isMaster;
    }
    if (socket.serverId) {
        result.serverId = socket.serverId;
    }
    if (socket.startUpDate) {
        result.startUpDate = socket.startUpDate;
    }

    return result;
};

exports.serializers.client = function (socket) {
    if (!socket.io) {
        return socket;
    }

    var result = {
        uri: socket.io.uri
    };

    if (socket.priority) {
        result.priority = socket.priority;
    }
    if (socket.uptime) {
        result.uptime = socket.uptime;
    }
    if (socket.nodeName) {
        result.nodeName = socket.nodeName;
    }
    if (socket.isMaster) {
        result.isMaster = socket.isMaster;
    }
    if (socket.serverId) {
        result.serverId = socket.serverId;
    }
    if (socket.startUpDate) {
        result.startUpDate = socket.startUpDate;
    }

    return result;
};

exports.serializers = Hoek.applyToDefaults(Bunyan.stdSerializers, exports.serializers);
