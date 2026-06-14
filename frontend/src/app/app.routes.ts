import { Routes } from '@angular/router';

import { AppShell } from './layout/app-shell/app-shell';
import { Datasets } from './features/datasets/datasets';
import { Explorer } from './features/explorer/explorer';
import { Overview } from './features/overview/overview';
import { Pivot } from './features/pivot/pivot';
import { CreateProject } from './features/projects/create-project/create-project';
import { canDeactivateCreateProject } from './features/projects/create-project/create-project.guard';
import { Projects } from './features/projects/projects';
import { Reports } from './features/reports/reports';
import { Settings } from './features/settings/settings';

export const routes: Routes = [
  {
    path: '',
    component: AppShell,
    children: [
      { path: 'projects', component: Projects, title: 'Projects | Analytica' },
      {
        path: 'projects/create',
        component: CreateProject,
        title: 'Create Project | Analytica',
        canDeactivate: [canDeactivateCreateProject],
      },
      {
        path: 'projects/create/:draftId',
        component: CreateProject,
        title: 'Create Project | Analytica',
        canDeactivate: [canDeactivateCreateProject],
      },
      { path: 'project/overview', component: Overview, title: 'Overview | Analytica' },
      { path: 'project/datasets', component: Datasets, title: 'Datasets | Analytica' },
      { path: 'project/explorer', component: Explorer, title: 'Explorer | Analytica' },
      { path: 'project/pivot', component: Pivot, title: 'Pivot | Analytica' },
      {
        path: 'project/visuals',
        loadComponent: () => import('./features/visuals/visuals').then((module) => module.Visuals),
        title: 'Visuals | Analytica',
      },
      { path: 'project/reports', component: Reports, title: 'Reports | Analytica' },
      { path: 'project/settings', redirectTo: '/settings' },
      { path: 'settings', component: Settings, title: 'Settings | Analytica' },
      { path: '', pathMatch: 'full', redirectTo: 'projects' },
    ],
  },
  { path: '**', redirectTo: 'projects' },
];
