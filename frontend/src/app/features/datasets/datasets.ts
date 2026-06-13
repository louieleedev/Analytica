import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-datasets',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './datasets.html',
})
export class Datasets {
  protected readonly previewColumns = [
    'RowId',
    'CompanyCode',
    'PostingDate',
    'AccountNumber',
    'CostCenter',
    'AmountLocal',
    'Currency',
  ];

  protected readonly previewRows = [
    ['1', '1000', '2026-01-04', '400100', 'CC-120', '18,240.00', 'USD'],
    ['2', '1000', '2026-01-04', '510020', 'CC-210', '-4,812.50', 'USD'],
    ['3', '2200', '2026-01-05', '410050', 'CC-330', '91,004.11', 'EUR'],
    ['4', '3100', '2026-01-06', '620010', 'CC-180', '7,450.00', 'GBP'],
    ['5', '2200', '2026-01-06', '400100', 'CC-330', '245,000.00', 'EUR'],
  ];

  protected readonly importedFiles = [
    // Future FastAPI services will perform file validation, schema comparison, and upload processing.
    { name: 'financial_export_q1.csv', size: '12.1 GB', status: 'Schema Match', tone: 'ok' },
    { name: 'financial_export_q2.csv', size: '11.7 GB', status: 'Schema Match', tone: 'ok' },
    { name: 'manual_adjustments.csv', size: '48 MB', status: 'Warning', tone: 'warn' },
    { name: 'corrupted_export.csv', size: '2.1 MB', status: 'Error', tone: 'error' },
  ];
}
