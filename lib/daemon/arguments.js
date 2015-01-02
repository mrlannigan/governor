'use strict';

var Bossy = require('bossy'),
    Hoek = require('hoek-boom'),
    util = require('util');

function DaemonArguments () {
    var args;

    args = Bossy.parse(this.getDefinition());

    if (args instanceof Error) {
        this.error = args;
    } else {
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
        alias: 'p',
        type: 'number',
        description: 'Declare this instance\'s priority for master election. 0 = never selected'
    };

    return definition;
};

DaemonArguments.prototype.getHelpText = function DaemonArgumentsGetHelpText() {
    var definition = [],
        tab = '    ';

    definition.push('usage: governor [-p|--priority X] [node ..]');
    definition.push('');
    definition.push(util.format('%s--priority X%sNumerical priority to aid in the election of a master.', tab, tab));
    definition.push(util.format('%s            %sThe node with the highest priority will be elected.', tab, tab));
    definition.push(util.format('%s            %sPriority defaults to 1.', tab, tab));
    definition.push(util.format('%s            %sA priority of 0 will prevent it from ever being elected.', tab, tab));

    definition = definition.join('\n');
    return definition;
};

module.exports = DaemonArguments;