import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

import { ApplicationSettings } from './import-workflow.models';
import { ImportApi } from './import-api';

const DEFAULT_SETTINGS: ApplicationSettings = {
  pivot_max_rows: 100,
  table_density: 'comfort',
};

@Injectable({ providedIn: 'root' })
export class ApplicationSettingsStore {
  private readonly document = inject(DOCUMENT);
  private readonly importApi = inject(ImportApi);

  readonly settings = signal<ApplicationSettings>(DEFAULT_SETTINGS);
  readonly isLoading = signal(false);

  constructor() {
    effect(() => {
      this.document.documentElement.dataset['tableDensity'] = this.settings().table_density;
    });
  }

  load(): void {
    this.isLoading.set(true);
    this.importApi.getSettings().subscribe({
      next: (response) => {
        this.settings.set(response.settings);
        this.isLoading.set(false);
      },
      error: () => {
        this.settings.set(DEFAULT_SETTINGS);
        this.isLoading.set(false);
      },
    });
  }

  update(settings: ApplicationSettings): void {
    this.settings.set(settings);
  }
}
