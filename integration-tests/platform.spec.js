/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

var helpers = require('../spec-cordova/helpers'),
    path = require('path'),
    fs = require('fs'),
    shell = require('shelljs'),
    superspawn = require('cordova-common').superspawn,
    config = require('../src/cordova/config'),
    Q = require('q'),
    events = require('cordova-common').events,
    cordova = require('../src/cordova/cordova'),
    plugman = require('../src/plugman/plugman'),
    rewire = require('rewire'),
    platform = rewire('../src/cordova/platform');

var projectRoot = 'C:\\Projects\\cordova-projects\\move-tracker';
var fixturesDir = path.join(__dirname, '..', 'spec-cordova', 'fixtures');
var pluginsDir = path.join(fixturesDir, 'plugins');

describe('platform end-to-end', function () {

    var tmpDir = helpers.tmpDir('platform_test');
    var project = path.join(tmpDir, 'project');

    var results;

    beforeEach(function() {
        shell.rm('-rf', tmpDir);

        // cp then mv because we need to copy everything, but that means it'll copy the whole directory.
        // Using /* doesn't work because of hidden files.
        shell.cp('-R', path.join(fixturesDir, 'base'), tmpDir);
        shell.mv(path.join(tmpDir, 'base'), project);
        process.chdir(project);

        // Now we load the config.json in the newly created project and edit the target platform's lib entry
        // to point at the fixture version. This is necessary so that cordova.prepare can find cordova.js there.
        var c = config.read(project);
        c.lib[helpers.testPlatform].url = path.join(fixturesDir, 'platforms', helpers.testPlatform + '-lib');
        config.write(project, c);

        // The config.json in the fixture project points at fake "local" paths.
        // Since it's not a URL, the lazy-loader will just return the junk path.
        spyOn(superspawn, 'spawn').and.callFake(function(cmd, args) {
            if (cmd.match(/create\b/)) {
                // This is a call to the bin/create script, so do the copy ourselves.
                shell.cp('-R', path.join(fixturesDir, 'platforms', 'android'), path.join(project, 'platforms'));
            } else if(cmd.match(/version\b/)) {
                return Q('3.3.0');
            } else if(cmd.match(/update\b/)) {
                fs.writeFileSync(path.join(project, 'platforms', helpers.testPlatform, 'updated'), 'I was updated!', 'utf-8');
            }
            return Q();
        });

        events.on('results', function(res) { results = res; });
    });

    afterEach(function() {
        process.chdir(path.join(__dirname, '..'));  // Needed to rm the dir on Windows.
        shell.rm('-rf', tmpDir);
    });

    // Factoring out some repeated checks.
    function emptyPlatformList() {
        return cordova.platform('list').then(function() {
            var installed = results.match(/Installed platforms:\n  (.*)/);
            expect(installed).toBeDefined();
            expect(installed[1].indexOf(helpers.testPlatform)).toBe(-1);
        });
    }
    function fullPlatformList() {
        return cordova.platform('list').then(function() {
            var installed = results.match(/Installed platforms:\n  (.*)/);
            expect(installed).toBeDefined();
            expect(installed[1].indexOf(helpers.testPlatform)).toBeGreaterThan(-1);
        });
    }

    // The flows we want to test are add, rm, list, and upgrade.
    // They should run the appropriate hooks.
    // They should fail when not inside a Cordova project.
    // These tests deliberately have no beforeEach and afterEach that are cleaning things up.
    //
    // This test was designed to use a older version of android before API.js
    // It is not valid anymore.
    xit('Test 001 : should successfully run', function(done) {

        // Check there are no platforms yet.
        emptyPlatformList().then(function() {
            // Add the testing platform.
            return cordova.platform('add', [helpers.testPlatform]);
        }).then(function() {
            // Check the platform add was successful.
            expect(path.join(project, 'platforms', helpers.testPlatform)).toExist();
            expect(path.join(project, 'platforms', helpers.testPlatform, 'cordova')).toExist();
        }).then(fullPlatformList) // Check for it in platform ls.
        .then(function() {
            // Try to update the platform.
            return cordova.platform('update', [helpers.testPlatform]);
        }).then(function() {
            // Our fake update script in the exec mock above creates this dummy file.
            expect(path.join(project, 'platforms', helpers.testPlatform, 'updated')).toExist();
        }).then(fullPlatformList) // Platform should still be in platform ls.
        .then(function() {
            // And now remove it.
            return cordova.platform('rm', [helpers.testPlatform]);
        }).then(function() {
            // It should be gone.
            expect(path.join(project, 'platforms', helpers.testPlatform)).not.toExist();
        }).then(emptyPlatformList) // platform ls should be empty too.
        .fail(function(err) {
            expect(err).toBeUndefined();
        }).fin(done);
    });

    it('Test 002 : should install plugins correctly while adding platform', function(done) {

        cordova.plugin('add', path.join(pluginsDir, 'test'))
        .then(function() {
            return cordova.platform('add', [helpers.testPlatform]);
        })
        .then(function() {
            // Check the platform add was successful.
            expect(path.join(project, 'platforms', helpers.testPlatform)).toExist();
            // Check that plugin files exists in www dir
            expect(path.join(project, 'platforms', helpers.testPlatform, 'assets/www/test.js')).toExist();
        })
        .fail(function(err) {
            expect(err).toBeUndefined();
        })
        .fin(done);
    },60000);

    it('Test 003 : should call prepare after plugins were installed into platform', function(done) {
        var order = '';
        var fail = jasmine.createSpy(fail);
        spyOn(plugman, 'install').and.callFake(function() { order += 'I'; });
        spyOn(cordova, 'prepare').and.callFake(function() { order += 'P'; });

        cordova.plugin('add', path.join(pluginsDir, 'test'))
        .then(function() {
            return cordova.platform('add', [helpers.testPlatform]);
        })
        .fail(fail)
        .fin(function() {
            expect(order).toBe('IP'); // Install first, then prepare
            expect(fail).not.toHaveBeenCalled();
            done();
        });
    });
});


describe('platform add plugin rm end-to-end', function () {

    var tmpDir = helpers.tmpDir('plugin_rm_test');
    var project = path.join(tmpDir, 'hello');
    var pluginsDir = path.join(project, 'plugins');

    beforeEach(function() {
        process.chdir(tmpDir);
    });

    afterEach(function() {
        process.chdir(path.join(__dirname, '..'));  // Needed to rm the dir on Windows.
        shell.rm('-rf', tmpDir);
    });

    it('Test 006 : should remove dependency when removing parent plugin', function(done) {

        cordova.create('hello')
        .then(function() {
            process.chdir(project);
            return cordova.platform('add', 'browser@latest');
        })
        .then(function() {
            return cordova.plugin('add', 'cordova-plugin-media');
        })
        .then(function() {
            expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
            return cordova.platform('add', 'android');
        })
        .then(function() {
            expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
            return cordova.plugin('rm', 'cordova-plugin-media');
        })
        .then(function() {
            expect(path.join(pluginsDir, 'cordova-plugin-media')).not.toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-file')).not.toExist();
        })
        .fail(function(err) {
            console.error(err);
            expect(err).toBeUndefined();
        })
        .fin(done);
    }, 100000);
});

describe('platform add and remove --fetch', function () {

    var tmpDir = helpers.tmpDir('plat_add_remove_fetch_test');
    var project = path.join(tmpDir, 'helloFetch');
    var platformsDir = path.join(project, 'platforms');
    var nodeModulesDir = path.join(project, 'node_modules');

    beforeEach(function() {
        process.chdir(tmpDir);
    });

    afterEach(function() {
        process.chdir(path.join(__dirname, '..'));  // Needed to rm the dir on Windows.
        shell.rm('-rf', tmpDir);
    });

    it('Test 007 : should add and remove platform from node_modules directory', function(done) {

        cordova.create('helloFetch')
        .then(function() {
            process.chdir(project);
            return cordova.platform('add', 'browser', {'fetch':true});
        })
        .then(function() {
            expect(path.join(nodeModulesDir, 'cordova-browser')).toExist();
            expect(path.join(platformsDir, 'browser')).toExist();
            return cordova.platform('add', 'android', {'fetch':true});
        })
        .then(function() {
            expect(path.join(nodeModulesDir, 'cordova-browser')).toExist();
            expect(path.join(platformsDir, 'android')).toExist();
            //Tests finish before this command finishes resolving
            //return cordova.platform('rm', 'ios', {'fetch':true});
        })
        .then(function() {
            //expect(path.join(nodeModulesDir, 'cordova-ios')).not.toExist();
            //expect(path.join(platformsDir, 'ios')).not.toExist();
            //Tests finish before this command finishes resolving
            //return cordova.platform('rm', 'android', {'fetch':true});
        })
        .then(function() {
            //expect(path.join(nodeModulesDir, 'cordova-android')).not.toExist();
            //expect(path.join(platformsDir, 'android')).not.toExist();
        })
        .fail(function(err) {
            console.error(err);
            expect(err).toBeUndefined();
        })
        .fin(done);
    }, 100000);
});

describe('plugin add and rm end-to-end --fetch', function () {

    var tmpDir = helpers.tmpDir('plugin_rm_fetch_test');
    var project = path.join(tmpDir, 'hello3');
    var pluginsDir = path.join(project, 'plugins');

    beforeEach(function() {
        process.chdir(tmpDir);
    });

    afterEach(function() {
        process.chdir(path.join(__dirname, '..'));  // Needed to rm the dir on Windows.
        shell.rm('-rf', tmpDir);
    });

    it('Test 008 : should remove dependency when removing parent plugin', function(done) {

        cordova.create('hello3')
        .then(function() {
            process.chdir(project);
            return cordova.platform('add', 'browser', {'fetch': true});
        })
        .then(function() {
            return cordova.plugin('add', 'cordova-plugin-media', {'fetch': true});
        })
        .then(function() {
            expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-compat')).toExist();
            expect(path.join(project, 'node_modules', 'cordova-plugin-media')).toExist();
            expect(path.join(project, 'node_modules', 'cordova-plugin-file')).toExist();
            expect(path.join(project, 'node_modules', 'cordova-plugin-compat')).toExist();
            return cordova.platform('add', 'android', {'fetch':true});
        })
        .then(function() {
            expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
            return cordova.plugin('rm', 'cordova-plugin-media', {'fetch':true});
        })
        .then(function() {
            expect(path.join(pluginsDir, 'cordova-plugin-media')).not.toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-file')).not.toExist();
            expect(path.join(pluginsDir, 'cordova-plugin-compat')).not.toExist();
            //These don't work yet due to the tests finishing before the promise resolves.
            //expect(path.join(project, 'node_modules', 'cordova-plugin-media')).not.toExist();
            //expect(path.join(project, 'node_modules', 'cordova-plugin-file')).not.toExist();
            //expect(path.join(project, 'node_modules', 'cordova-plugin-compat')).not.toExist();
        })
        .fail(function(err) {
            expect(err).toBeUndefined();
        })
        .fin(done);
    }, 60000);
});


describe('non-core platform add and rm end-to-end --fetch', function () {

    var tmpDir = helpers.tmpDir('non-core-platform-test');
    var project = path.join(tmpDir, 'hello');
    var results;

    beforeEach(function() {
        process.chdir(tmpDir);
        events.on('results', function(res) { results = res; });
    });

    afterEach(function() {
        process.chdir(path.join(__dirname, '..'));  // Needed to rm the dir on Windows.
        shell.rm('-rf', tmpDir);
    });

    it('Test 009 : should add and remove 3rd party platforms', function(done) {
        var installed;
        cordova.create('hello')
        .then(function() {
            process.chdir(project);
            //add cordova-android instead of android
            return cordova.platform('add', 'cordova-android', {'fetch': true});
        }).then(function() {
            //3rd party platform from npm
            return cordova.platform('add', 'cordova-platform-test', {'fetch': true});
        }).then(function() {
            expect(path.join(project, 'platforms', 'android')).toExist();
            expect(path.join(project, 'platforms', 'cordova-platform-test')).toExist();
            return cordova.platform('ls');
        })
        .then(function() {
            //use regex to grab installed platforms
            installed = results.match(/Installed platforms:\n  (.*)\n  (.*)/);
            expect(installed).toBeDefined();
            expect(installed[1].indexOf('android')).toBeGreaterThan(-1);
            expect(installed[2].indexOf('cordova-platform-test')).toBeGreaterThan(-1);
        }).fail(function(err) {
            expect(err).toBeUndefined();
        })
        .fin(done);
    }, 90000);
});
