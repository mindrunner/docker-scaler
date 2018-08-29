'use strict';

class hookException extends Error {
    constructor(message) {
        super(message);
        this.message = message;
        this.name = 'HookException';
    }
}

module.exports = hookException;