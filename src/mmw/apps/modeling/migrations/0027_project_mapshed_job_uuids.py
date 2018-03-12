# -*- coding: utf-8 -*-
from __future__ import unicode_literals

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('modeling', '0026_delete_hydroshareresource'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='mapshed_job_uuid',
            field=models.UUIDField(help_text='The job used to calculate the MapShed results. Used for getting the results of that job.', null=True),
        ),
        migrations.AddField(
            model_name='project',
            name='subbasin_mapshed_job_uuid',
            field=models.UUIDField(help_text='The job used to calculate the mapshed results for each HUC-12 sub-basin of the shape.', null=True),
        ),
    ]
