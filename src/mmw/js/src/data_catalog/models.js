"use strict";

var $ = require('jquery'),
    _ = require('lodash'),
    Backbone = require('../../shim/backbone'),
    moment = require('moment'),
    settings = require('../core/settings');

var REQUEST_TIMED_OUT_CODE = 408;
var DESCRIPTION_MAX_LENGTH = 100;
var PAGE_SIZE = settings.get('data_catalog_page_size');

var DATE_FORMAT = 'MM/DD/YYYY';
var WATERML_VARIABLE_TIME_INTERVAL = '{http://www.cuahsi.org/water_ml/1.1/}variable_time_interval';


var FilterModel = Backbone.Model.extend({
    defaults: {
        id: '',
        type: '',
        isValid: true
    },

    reset: function() {
        // Clear all model attributes and set back any defaults.
        // Once we've called `.clear()` we lose the ability to detect
        // actual changed attributes after the `.set()`.
        // Store the prev state to check if a change event
        // should fire
        var prevAttr = _.clone(this.attributes);
        this.clear({ silent: true }).set(this.defaults,
                                         { silent: true });
        if (!_.isEqual(this.attributes, prevAttr)) {
            this.trigger("change", this);
        }
    },

    validate: function() {
        return true;
    },

    isActive: function() {
        window.console.error("Use of unimplemented function",
                             "FilterModel.isActive");
        return false;
    }
});

var SearchOption = FilterModel.extend({
    defaults: _.defaults({
        active: false,
    }, FilterModel.prototype.defaults),

    isActive: function() {
        return this.get('active');
    }
});

var GriddedServicesFilter = SearchOption.extend({
    defaults: _.defaults({
        id: 'gridded',
        type: 'checkbox',
        label: 'Gridded Services',
    }, SearchOption.prototype.defaults)
});

var DateFilter = FilterModel.extend({
    defaults: _.defaults({
        id: 'date',
        type: 'date',
        fromDate: null,
        toDate: null,
    }, FilterModel.prototype.defaults),

    isActive: function() {
        return this.get('fromDate') || this.get('toDate');
    },

    validate: function() {
        // Only need to validate if there are two dates.  Ensure that
        // before is earlier than after
        var toDate = this.get('toDate'),
            fromDate = this.get('fromDate'),
            isValid = true;

        if (toDate && !moment(toDate, DATE_FORMAT).isValid()) {
            isValid = false;
        }

        if (fromDate && !moment(fromDate, DATE_FORMAT).isValid()) {
            isValid = false;
        }

        if (toDate && fromDate){
            isValid = moment(fromDate, DATE_FORMAT)
                .isBefore(moment(toDate, DATE_FORMAT));
        }

        this.set('isValid', isValid);
        return isValid;
    }
});

var FilterCollection = Backbone.Collection.extend({
    model: FilterModel,

    countActive: function() {
        var isActive = function(filter) { return filter.isActive(); };

        return this.filter(isActive).length;
    },
});

var Catalog = Backbone.Model.extend({
    defaults: {
        id: '',
        name: '',
        description: '',
        query: '',
        geom: '',
        loading: false,
        stale: false, // Should search run when catalog becomes active?
        active: false,
        results: null, // Results collection
        resultCount: 0,
        filters: null, // FiltersCollection
        is_pageable: true,
        page: 1,
        error: '',
        detail_result: null
    },

    initialize: function() {
        var self = this;
        this.get('results').on('change:show_detail', function() {
            self.set('detail_result', self.get('results').getDetail());
        });

        // Initialize and listen to filters for changes
        if (this.get('filters') === null) {
            this.set({ filters: new FilterCollection() });
        }
        this.get('filters').on('change', function() {
            if (self.isSearchValid()) {
                if (self.get('active')) {
                    self.startSearch(1);
                } else {
                    self.set('stale', true);
                }
            }
        });
    },

    searchIfNeeded: function(query, geom) {
        var self = this,
            error = this.get('error'),
            stale = this.get('stale'),
            isSameSearch = query === this.get('query') &&
                           geom === this.get('geom');

        if (!isSameSearch || stale || error) {
            this.cancelSearch();
            this.searchPromise = this.search(query, geom)
                                     .always(function() {
                                        delete self.searchPromise;
                                     });
        }

        return this.searchPromise || $.when();
    },

    cancelSearch: function() {
        if (this.searchPromise) {
            this.searchPromise.abort();
        }
    },

    search: function(query, geom) {
        this.set({
            query: query,
            geom: geom,
        });

        return this.startSearch(1);
    },

    isSearchValid: function() {
        var query = this.get('query'),
            validate = function(filter) { return filter.validate(); },
            valid = this.get('filters').map(validate);

        return query && _.every(valid);
    },

    startSearch: function(page) {
        var filters = this.get('filters'),
            dateFilter = filters.findWhere({ id: 'date' }),
            fromDate = null,
            toDate = null;

        if (dateFilter) {
            fromDate = dateFilter.get('fromDate');
            toDate = dateFilter.get('toDate');
        }

        var lastPage = Math.ceil(this.get('resultCount') / PAGE_SIZE),
            thisPage = parseInt(page) || 1,
            isSearchOption = function(filter) { return filter instanceof SearchOption; },
            searchOptions = filters.filter(isSearchOption),
            data = {
                catalog: this.id,
                query: this.get('query'),
                geom: this.get('geom'),
                from_date: fromDate,
                to_date: toDate,
            };

        if (thisPage > 1 && thisPage <= lastPage) {
            _.assign(data, { page: thisPage });
        }

        if (searchOptions && searchOptions.length > 0) {
            var isActive = function(option) { return option.isActive(); },
                id = function(option) { return option.get('id'); };
            _.assign(data, {
                options: _.map(_.filter(searchOptions, isActive), id).join(',')
            });
        }

        this.set('loading', true);
        this.set('error', false);

        var request = {
            data: JSON.stringify(data),
            type: 'POST',
            dataType: 'json',
            contentType: 'application/json'
        };

        return this.get('results')
                   .fetch(request)
                   .done(_.bind(this.doneSearch, this))
                   .fail(_.bind(this.failSearch, this))
                   .always(_.bind(this.finishSearch, this));
    },

    doneSearch: function(response) {
        var data = _.findWhere(response, { catalog: this.id });

        this.set({
            page: data.page || 1,
            resultCount: data.count,
        });
    },

    failSearch: function(response, textStatus) {
        if (textStatus === "abort") {
            // Do nothing if the search failed because it
            // was purposefully cancelled
            return;
        }
        if (response.status === REQUEST_TIMED_OUT_CODE){
            this.set('error', "Searching took too long. " +
                              "Consider trying a smaller area of interest " +
                              "or a more specific search term.");
        } else {
            this.set('error', "Error");
        }
    },

    finishSearch: function() {
        this.set({
            loading: false,
            stale: false,
        });
    },

    previousPage: function() {
        var page = this.get('page');

        if (page > 1) {
            return this.startSearch(page - 1);
        } else {
            return $.when();
        }
    },

    nextPage: function() {
        var page = this.get('page'),
            count = this.get('resultCount'),
            lastPage = Math.ceil(count / PAGE_SIZE);

        if (page < lastPage) {
            return this.startSearch(page + 1);
        } else {
            return $.when();
        }
    }
});

var Catalogs = Backbone.Collection.extend({
    model: Catalog,

    getActiveCatalog: function() {
        return this.findWhere({ active: true });
    }
});

var Result = Backbone.Model.extend({
    defaults: {
        id: '',
        title: '',
        description: '',
        geom: null, // GeoJSON
        links: null, // Array
        created_at: '',
        updated_at: '',
        active: false,
        show_detail: false, // Show this result as the detail view?
        variables: null,  // CuahsiVariables Collection
        fetching: false,
        error: false,
        mode: 'table',
    },

    initialize: function(attrs) {
        // For CUAHSI
        if (attrs.variables) {
            this.set('variables', new CuahsiVariables(attrs.variables));
        }
    },

    parse: function(response) {
        // For CUAHSI
        if (response.variables) {
            var variables = this.get('variables');
            if (variables instanceof CuahsiVariables) {
                variables.reset(response.variables);
                delete response.variables;
            }
        }

        return response;
    },

    fetchCuahsiValues: function(opts) {
        if (this.fetchPromise && !this.get('error')) {
            return this.fetchPromise;
        }

        opts = _.defaults(opts || {}, {
            onEachSearchDone: _.noop,
            onEachSearchFail: _.noop,
            from_date: null,
            to_date: null,
        });

        var self = this,
            variables = self.get('variables'),
            runSearches = function() {
                    return variables.map(function(v) {
                            return v.search(opts.from_date, opts.to_date)
                                    .done(opts.onEachSearchDone)
                                    .fail(opts.onEachSearchFail);
                        });
                },
            setSuccess = function() {
                    self.set('error', false);
                },
            setError = function() {
                    self.set('error', true);
                },
            startFetch = function() {
                    self.set('fetching', true);
                },
            endFetch = function() {
                    self.set('fetching', false);
                };

        startFetch();
        this.fetchPromise = $.get('/bigcz/details', {
                    catalog: 'cuahsi',
                    wsdl: variables.first().get('wsdl'),
                    site: self.get('id'),
                })
                .then(function(response) {
                    variables.forEach(function(v) {
                        var info = response.series[v.get('id')] || null,
                            interval = info && info[WATERML_VARIABLE_TIME_INTERVAL];

                        if (info) {
                            v.set({
                                'units': info.variable.units.abbreviation,
                                'speciation': info.variable.speciation,
                                'sample_medium': info.variable.sample_medium,
                            });

                            if (interval) {
                                v.set({
                                    'begin_date': new Date(interval.begin_date_time),
                                    'end_date': new Date(interval.end_date_time),
                                });
                            }
                        }
                    });
                }, function() {
                    // Handle error in /details/
                    setError();
                    endFetch();
                })
                .then(function() {
                    return $.when.apply($, runSearches())
                                 .done(setSuccess)
                                 .fail(setError)  // Handle error in /values/
                                 .always(endFetch);
                });

        return this.fetchPromise;
    },

    getSummary: function() {
        var text = this.get('description') || '';
        if (text.length <= DESCRIPTION_MAX_LENGTH) {
            return text;
        }
        var truncated = text.substr(0,
            text.indexOf(' ', DESCRIPTION_MAX_LENGTH));
        return truncated + '&hellip;';
    },

    getDetailsUrl: function() {
        var links = this.get('links') || [],
            detailsUrl = _.findWhere(links, { type: 'details' });
        return detailsUrl && detailsUrl.href;
    },

    toJSON: function() {
        return _.assign({}, this.attributes, {
            summary: this.getSummary(),
            detailsUrl: this.getDetailsUrl()
        });
    }
});

var Results = Backbone.Collection.extend({
    url: '/bigcz/search',
    model: Result,

    initialize: function(models, options) {
        this.catalog = options.catalog;
    },

    parse: function(response) {
        return _.findWhere(response, { catalog: this.catalog }).results;
    },

    getDetail: function() {
        return this.findWhere({ show_detail: true});
    },

    showDetail: function(result) {
        var currentDetail = this.getDetail();

        if (currentDetail) {
            // Do nothing if the selected result is already the detail shown
            if (currentDetail.get('id') === result.get('id')) {
                return;
            }
            // Turn off the actively shown detail. There should only be
            // one with `show_detail` true at a time
            currentDetail.set('show_detail', false);
        }

        result.set('show_detail', true);
    },

    closeDetail: function() {
        var currentDetail = this.getDetail();

        if (!currentDetail) {
            return;
        }

        currentDetail.set('show_detail', false);
    }
});

var SearchForm = Backbone.Model.extend({
    defaults: {
        query: '',
    }
});

var PopoverControllerModel = Backbone.Model.extend({
    defaults: {
        activeResult: null // Result
    }
});

var CuahsiValue = Backbone.Model.extend({
    defaults: {
        source_id: '',
        source_code: '',
        quality_control_level_code: '',
        value: null,
        datetime: '',
        date_time_utc: '',
        time_offset: '',
    }
});

var CuahsiValues = Backbone.Collection.extend({
    model: CuahsiValue,
});

var CuahsiVariable = Backbone.Model.extend({
    url: '/bigcz/values',

    defaults: {
        id: '',
        name: '',
        units: '',
        concept_keyword: '',
        speciation: '',
        sample_medium: '',
        wsdl: '',
        site: '',
        values: null, // CuahsiValues Collection
        most_recent_value: null,
        begin_date: '',
        end_date: '',
        error: null,
    },

    initialize: function() {
        this.set('values', new CuahsiValues());
    },

    search: function(from, to) {
        var self = this,
            begin_date = moment(this.get('begin_date')),
            end_date = moment(this.get('end_date')),
            params = {
                catalog: 'cuahsi',
                wsdl: this.get('wsdl'),
                site: this.get('site'),
                variable: this.get('id'),
            };

        // If neither from date nor to date is specified, set time interval
        // to be either from begin date to end date, or 1 week up to end date,
        // whichever is shorter.
        if (!from || moment(from).isBefore(begin_date)) {
            if (end_date.diff(begin_date, 'months', true) > 1) {
                params.from_date = moment(end_date).subtract(1, 'months');
            } else {
                params.from_date = begin_date;
            }
        } else {
            params.from_date = moment(from);
        }

        if (!to || moment(to).isAfter(end_date)) {
            params.to_date = end_date;
        } else {
            params.to_date = moment(to);
        }

        params.from_date = params.from_date.format(DATE_FORMAT);
        params.to_date = params.to_date.format(DATE_FORMAT);

        this.set('error', null);

        return this.fetch({
                data: params,
                processData: true,
            })
            .fail(function(error) {
                self.set('error', 'Error ' + error.status + ' during fetch');
            });
    },

    parse: function(response) {
        var mrv = null;

        if (response.values && response.values.length > 0) {
            var values = this.get('values');

            values.reset(response.values);
            mrv = response.values[response.values.length - 1].value;
        } else {
            this.set('error', 'No values returned from API');
        }

        return {
            name: response.variable.name,
            sample_medium: response.variable.sample_medium,
            units: response.variable.units.abbreviation,
            most_recent_value: mrv,
        };
    }
});

var CuahsiVariables = Backbone.Collection.extend({
    model: CuahsiVariable,
});

module.exports = {
    GriddedServicesFilter: GriddedServicesFilter,
    DateFilter: DateFilter,
    FilterCollection: FilterCollection,
    Catalog: Catalog,
    Catalogs: Catalogs,
    Result: Result,
    Results: Results,
    SearchForm: SearchForm,
    PopoverControllerModel: PopoverControllerModel,
    CuahsiValue: CuahsiValue,
    CuahsiValues: CuahsiValues,
    CuahsiVariable: CuahsiVariable,
    CuahsiVariables: CuahsiVariables,
};
