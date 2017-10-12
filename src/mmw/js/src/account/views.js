"use strict";

var Clipboard = require('clipboard'),
    Marionette = require('../../shim/backbone.marionette'),
    moment = require('moment'),
    modalViews = require('../core/modals/views'),
    modalModels = require('../core/modals/models'),
    models = require('./models'),
    containerTmpl = require('./templates/container.html'),
    profileTmpl = require('./templates/profile.html'),
    accountTmpl = require('./templates/account.html');

var ProfileView = Marionette.ItemView.extend({
    template: profileTmpl
});

var AccountView = Marionette.ItemView.extend({
    // model ApiTokenModel
    template: accountTmpl,

    ui: {
        regenerateKey: '[data-action="regeneratekey"]',
        copyKey: '[data-action="copykey"]'
    },

    events: {
        'click @ui.regenerateKey': 'regenerateApiKey'
    },

    modelEvents: {
        'change': 'render'
    },

    onRender: function() {
        new Clipboard(this.ui.copyKey[0]);
    },

    templateHelpers: function() {
        var dateFormat = 'MMM D, YYYY, h:mm A',
            formattedCreatedAt = moment(this.model.get('created_at'))
                                        .format(dateFormat);
        return {
            created_at_formatted: formattedCreatedAt
        };
    },

    regenerateApiKey: function() {
        var self = this,
            titleText = 'Do you definitely want to do this?',
            detailText = 'Resetting your API key will invalidate ' +
                         'your previous one',
            modal = new modalViews.ConfirmView({
                model: new modalModels.ConfirmModel({
                    titleText: titleText,
                    className: 'modal-content-danger modal-content-padded',
                    question: detailText,
                    confirmLabel: 'Yes, reset API key',
                    cancelLabel: 'No, keep current key'
                })
            });

        modal.render();

        modal.on('confirmation', function() {
            self.model.regenerateToken();
        });
    }
});

var AccountContainerView = Marionette.LayoutView.extend({
    // model AccountContainerModel

    template: containerTmpl,

    ui: {
        profile: '[data-action="viewprofile"]',
        account: '[data-action="viewaccount"]'
    },

    events: {
        'click @ui.profile': 'viewProfile',
        'click @ui.account': 'viewAccount'
    },

    modelEvents: {
        'change:active_page': 'render'
    },

    regions: {
        infoContainer: '.account-page-container'
    },

    initialize: function() {
        this.tokenModel = new models.ApiTokenModel();
    },

    showActivePage: function() {
        var activePage = this.model.get('active_page');

        switch(activePage) {
            case models.PROFILE:
                this.infoContainer.show(new ProfileView());
                break;
            case models.ACCOUNT:
                this.infoContainer.show(new AccountView({
                    model: this.tokenModel
                }));
                break;
            default:
                console.error("Account page, ", activePage,
                              ", is not supported.");
        }
    },

    onRender: function() {
        this.showActivePage();
    },

    viewProfile: function() {
        this.model.set('active_page', models.PROFILE);
    },

    viewAccount: function() {
        this.model.set('active_page', models.ACCOUNT);
    }
});

module.exports = {
    AccountContainerView: AccountContainerView
};
