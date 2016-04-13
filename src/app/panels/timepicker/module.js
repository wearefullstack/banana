/*

  ## Timepicker2

  ### Parameters
  * mode :: The default mode of the panel. Options: 'relative', 'absolute' 'since' Default: 'relative'
  * time_options :: An array of possible time options. Default: ['5m','15m','1h','6h','12h','24h','2d','7d','30d']
  * timespan :: The default options selected for the relative view. Default: '15m'
  * timefield :: The field in which time is stored in the document.
  * refresh: Object containing refresh parameters
    * enable :: true/false, enable auto refresh by default. Default: false
    * interval :: Seconds between auto refresh. Default: 30
    * min :: The lowest interval a user may set
*/
define([
  'angular',
  'app',
  'underscore',
  'moment',
  'kbn',
  'jquery'
],
function (angular, app, _, moment, kbn, $) {
    'use strict';

    var module = angular.module('kibana.panels.timepicker', []);
    app.useModule(module);

    module.controller('timepicker', function($scope, $modal, $q, filterSrv) {
        $scope.panelMeta = {
            modals: [{
                description: "Inspect",
                icon: "icon-info-sign",
                partial: "app/partials/inspector.html",
                show: true
            }],
            status  : "Stable",
            description : "A panel for controlling the time range filters. If you have time based data, "+
              " or if you're using time stamped indices, you need one of these"
        };

        // Set and populate defaults
        var _d = {
            status: "Stable",
            mode: "relative",
            time_options: ['5m', '15m', '1h', '6h', '12h', '24h', '2d', '7d', '30d'],
            timespan: '15m',
            timefield: 'event_timestamp',
            timeformat: "",
            spyable: true,
            refresh: {
                enable: false,
                interval: 30,
                min: 3
            }
        };
        _.defaults($scope.panel,_d);

        var customTimeModal = $modal({
            template: './app/panels/timepicker/custom.html',
            persist: true,
            show: false,
            scope: $scope,
            keyboard: false
        });

        $scope.filterSrv = filterSrv;

        // ng-pattern regexs
        $scope.patterns = {
            date: /^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/,
            hour: /^([01]?[0-9]|2[0-3])$/,
            minute: /^[0-5][0-9]$/,
            second: /^[0-5][0-9]$/,
            millisecond: /^[0-9]*$/
        };

        $scope.$on('refresh', function(){$scope.init();});

        $scope.init = function() {
            // Private refresh interval that we can use for view display without causing
            // unnecessary refreshes during changes
            $scope.refresh_interval = $scope.panel.refresh.interval;
            $scope.filterSrv = filterSrv;

            // Init a private time object with Date() objects depending on mode
            switch($scope.panel.mode) {
                case 'absolute':
                    $scope.time = {
                        from : moment($scope.panel.time.from,'MM/DD/YYYY HH:mm:ss') || moment(kbn.time_ago($scope.panel.timespan)),
                        to   : moment($scope.panel.time.to,'MM/DD/YYYY HH:mm:ss') || moment()
                    };
                    break;
                case 'since':
                    $scope.time = {
                        from : moment($scope.panel.time.from,'MM/DD/YYYY HH:mm:ss') || moment(kbn.time_ago($scope.panel.timespan)),
                        to   : moment()
                    };
                    break;
                case 'relative':
                    $scope.time = {
                        from : moment(kbn.time_ago($scope.panel.timespan)),
                        to   : moment()
                    };
                    break;
            }

            $scope.time.field = $scope.panel.timefield;
            // These 3 statements basicly do everything time_apply() does
            set_timepicker($scope.time.from,$scope.time.to);
            update_panel();

            // If we're in a mode where something must be calculated, clear existing filters
            // and set new ones
            //if($scope.panel.mode !== 'absolute') {
            set_time_filter($scope.time);
            //}

            dashboard.refresh();

            // Start refresh timer if enabled
            if ($scope.panel.refresh.enable) {
                $scope.set_interval($scope.panel.refresh.interval);
            }

            // In case some other panel broadcasts a time, set us to an absolute range
            $scope.$on('refresh', function() {
                if(filterSrv.idsByType('time').length > 0) {
                    var time = filterSrv.timeRange('min');
                    if($scope.time.from.diff(moment.utc(time.from),'seconds') !== 0 ||
                      $scope.time.to.diff(moment.utc(time.to),'seconds') !== 0) {
                        $scope.set_mode('absolute');
                        // These 3 statements basicly do everything time_apply() does
                        set_timepicker(moment(time.from),moment(time.to));
                        $scope.time = $scope.time_calc();
                        update_panel();
                    }
                }
            });
        };

        // Constantly validate the input of the fields. This function does not change any date variables
        // outside of its own scope
        $scope.validate = function(time) {
            // Assume the form is valid. There is a hidden dummy input for invalidating it programatically.
            $scope.input.$setValidity("dummy", true);

            var _from = datepickerToLocal(time.from.date),
              _to = datepickerToLocal(time.to.date),
              _t = time;

            if($scope.input.$valid) {
                _from.setHours(_t.from.hour,_t.from.minute,_t.from.second,_t.from.millisecond);
                _to.setHours(_t.to.hour,_t.to.minute,_t.to.second,_t.to.millisecond);

                // Check that the objects are valid and to is after from
                if(isNaN(_from.getTime()) || isNaN(_to.getTime()) || _from.getTime() >= _to.getTime()) {
                    $scope.input.$setValidity("dummy", false);
                    return false;
                }
            } else {
                return false;
            }

            return {from:_from,to:_to};
        };

        $scope.setNow = function() {
            $scope.time.to = getTimeObj(new Date());
        };

        var update_panel = function() {
            // Update panel's string representation of the time object. Don't update if
            // we're in relative mode since we dont want to store the time object in the
            // json for relative periods
            if($scope.panel.mode !== 'relative') {
                $scope.panel.time = {
                    from : $scope.time.from.format("MM/DD/YYYY HH:mm:ss"),
                    to : $scope.time.to.format("MM/DD/YYYY HH:mm:ss"),
                };
            } else {
                delete $scope.panel.time;

                $scope.setAbsoluteTimeFilter = function (time) {
                    // Create filter object
                    var _filter = _.clone(time);

                    _filter.type = 'time';
                    _filter.field = $scope.panel.timefield;

                    if($scope.panel.now) {
                        _filter.to = "now";
                    }

                    // Clear all time filters, set a new one
                    filterSrv.removeByType('time',true);

                    // Set the filter
                    $scope.panel.filter_id = filterSrv.set(_filter);

                    $scope.time_calc = function(){
                        var from,to;

                        // If time picker is defined (usually is) TOFIX: Horrible parsing
                        if(!(_.isUndefined($scope.timepicker))) {
                            // Fix for SILK-4 and SILK-29 bugs: by using moment.utc() instead of just moment()
                            // Need to account for leap year by using moment.subtract()
                            // Get the time suffix (ie.s/m/h/d/w/M/y)
                            var timeShorthand = $scope.panel.timespan.substr(-1);
                            var timeNumber = $scope.panel.timespan.substr(0, $scope.panel.timespan.length-1);

                            from = $scope.panel.mode === 'relative' ? moment().subtract(timeShorthand,timeNumber) :
                              moment(moment($scope.timepicker.from.date).format('MM/DD/YYYY') + " " + $scope.timepicker.from.time,'MM/DD/YYYY HH:mm:ss');
                            // from = $scope.panel.mode === 'relative' ? moment(kbn.time_ago($scope.panel.timespan)) :
                            //   moment(moment.utc($scope.timepicker.from.date).format('MM/DD/YYYY') + " " + $scope.timepicker.from.time,'MM/DD/YYYY HH:mm:ss');
                            to = $scope.panel.mode !== 'absolute' ? moment() :
                              moment(moment($scope.timepicker.to.date).format('MM/DD/YYYY') + " " + $scope.timepicker.to.time,'MM/DD/YYYY HH:mm:ss');

                            // Otherwise (probably initialization)
                        } else {
                            from = $scope.panel.mode === 'relative' ? moment(kbn.time_ago($scope.panel.timespan)) :
                              $scope.time.from;
                            to = $scope.panel.mode !== 'absolute' ? moment() :
                              $scope.time.to;
                        }

                        // Update our representation
                        $scope.time = getScopeTimeObj(time.from,time.to);
                    };

                    $scope.setRelativeFilter = function(timespan) {
                        $scope.time_apply = function() {
                            // Update internal time object
                            $scope.panel.error = "";

                            // Remove all other time filters
                            filterSrv.removeByType('time');

                            $scope.time = $scope.time_calc();
                            $scope.time.field = $scope.panel.timefield;

                            // Clear all time filters, set a new one
                            filterSrv.removeByType('time',true);

                            // Set the filter
                            $scope.panel.filter_id = filterSrv.set(_filter);

                            // Update our representation
                            $scope.time = getScopeTimeObj(kbn.parseDate(_filter.from),new Date());

                            return $scope.panel.filter_id;
                        };

                        dashboard.refresh();
                    };

                    // No need to automatically call time_apply() when changing time mode,
                    // because it will mess up the timepicker.
                    //
                    // $scope.$watch('panel.mode', $scope.time_apply);

                    $scope.time_check = function() {
                    };

                    function set_time_filter(time) {
                        time.type = 'time';
                        // Clear all time filters, set a new one
                        filterSrv.removeByType('time');
                        $scope.panel.filter_id = filterSrv.set(compile_time(time));
                        return $scope.panel.filter_id;
                    }

                    // Prefer to pass around Date() objects since interacting with
                    // moment objects in libraries that are expecting Date()s can be tricky
                    function compile_time(time) {
                        // Clone time obj
                        var filterTime = $.extend(true, {}, time);
                        if ($scope.panel.mode === 'relative') {
                            // Get the time suffix (ie.s/m/h/d/w/M/y)
                            var timeShorthand = $scope.panel.timespan.substr(-1);
                            var timeNumber = $scope.panel.timespan.substr(0, $scope.panel.timespan.length-1);
                            var timeUnit;
                            switch (timeShorthand) {
                                case 's':
                                    timeUnit = 'SECOND';
                                    break;
                                case 'm':
                                    timeUnit = 'MINUTE';
                                    break;
                                case 'h':
                                    timeUnit = 'HOUR';
                                    break;
                                case 'd':
                                    timeUnit = 'DAY';
                                    break;
                                case 'w':
                                    // Convert weeks into days
                                    timeNumber = timeNumber * 7;
                                    timeUnit = 'DAY';
                                    break;
                                case 'y':
                                    timeUnit = 'YEAR';
                                    break;
                            }
                            filterTime.from = 'NOW/' + timeUnit + '-' + timeNumber + timeUnit;
                            filterTime.to   = 'NOW/' + timeUnit + '%2B1' + timeUnit;
                            // Add Date objects representation of from and to, for use with histogram panel
                            // where it needs Date objects for plotting x-axis on a chart.
                            filterTime.fromDateObj = moment().subtract(timeShorthand,timeNumber).toDate();
                            filterTime.toDateObj = new Date();
                        } else if ($scope.panel.mode === 'since') {
                            // Add Date objects representation of from and to, for use with histogram panel
                            // where it needs Date objects for plotting x-axis on a chart.
                            filterTime.fromDateObj = filterTime.from.toDate();
                            filterTime.toDateObj = new Date();
                            filterTime.from = filterTime.from.toDate().toISOString() + '/SECOND';
                            filterTime.to   = '*';
                        } else if ($scope.panel.mode === 'absolute') {
                            filterTime.from = filterTime.from.toDate();
                            filterTime.to   = filterTime.to.toDate();
                        }

                        return filterTime;
                    }

                    function set_timepicker(from,to) {
                        // Janky 0s timeout to get around $scope queue processing view issue
                        $scope.timepicker = {
                            from : {
                                time : from.format("HH:mm:ss"),
                                date : from.format("MM/DD/YYYY")
                            },
                            to : {
                                time : to.format("HH:mm:ss"),
                                date : to.format("MM/DD/YYYY")
                            }
                        };
                    };

                    // Do not use the results of this function unless you plan to use setHour/Minutes/etc on the result
                    var datepickerToLocal = function(date) {
                        date = moment(date).clone().toDate();
                        return moment(new Date(date.getTime() + date.getTimezoneOffset() * 60000)).toDate();
                    };
                });
            });