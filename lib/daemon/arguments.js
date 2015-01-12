'use strict';

var Bossy = require('bossy'),
    Hoek = require('hoek-boom'),
    util = require('util'),
    Joi = require('joi');

function DaemonArguments (argv) {
    var args,
        NODE_ENV = process.env.NODE_ENV;

    args = Bossy.parse(this.getDefinition(), {argv: argv});

    this.environment = {
        development: NODE_ENV !== 'production',
        production: NODE_ENV === 'production'
    };

    if (args instanceof Error) {
        this.error = args;
    } else {
        args = this.validate(args);

        if (args._) {
            args.nodes = args._;
            delete args._;
        }

        Hoek.merge(this, args);
    }
}

DaemonArguments.prototype.getDefinition = function DaemonArgumentsGetDefinition() {
    var definition = {};

    definition.help = {
        alias: 'h',
        type: 'boolean',
        description: 'Show this help'
    };

    definition.priority = {
        type: 'string',
        description: 'Declare this instance\'s priority for master election. 0 = never selected'
    };

    definition.port = {
        alias: 'p',
        type: 'string',
        required: true,
        description: 'Server port'
    };

    definition['api-port'] = {
        alias: 'a',
        type: 'string',
        description: 'API Server port'
    };

    definition['node-name'] = {
        alias: 'n',
        type: 'string',
        description: 'Node name'
    };

    return definition;
};

DaemonArguments.prototype.getHelpText = function DaemonArgumentsGetHelpText() {
    var definition = [],
        tab = '    ';

    definition.push('usage: governor [-p|--port <port>] [-n|--node-name <name>] [--priority <priority>] <node>...');
    definition.push('');
    definition.push('Options');
    definition.push(util.format('%s--priority   %sNumerical priority to aid in the election of a master.', tab, tab));
    definition.push(util.format('%s             %sThe node with the highest priority will be elected.', tab, tab));
    definition.push(util.format('%s             %sPriority defaults to 1.', tab, tab));
    definition.push(util.format('%s             %sA priority of 0 will prevent it from ever being elected.', tab, tab));
    definition.push('');

    definition.push(util.format('%s-p, --port   %sNumerical port for the server to bind.', tab, tab));
    definition.push(util.format('%s-n, --node-name  Name of current node.', tab, tab));

    definition = definition.join('\n');
    return definition;
};

DaemonArguments.prototype.validate = function DaemonArgumentsValidate(args) {
    var schema,
        result;

    schema = Joi.object().keys({
        port: Joi.number().greater(0).integer().required(),
        'node-name': Joi.string().required(),
        priority: Joi.number().min(0).precision(1).default(1),
        p: Joi.number().valid(Joi.ref('port')),
        n: Joi.string().valid(Joi.ref('node-name')),
        _: Joi.array().unique().includes(Joi.string()).min(1)
    });

    result = Joi.validate(args, schema, {allowUnknown: true, convert: true});

    this.error = result.error;

    return result.value || args;
};

module.exports = DaemonArguments;