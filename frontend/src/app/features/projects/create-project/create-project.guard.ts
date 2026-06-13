import { CanDeactivateFn } from '@angular/router';

import { CreateProject } from './create-project';

export const canDeactivateCreateProject: CanDeactivateFn<CreateProject> = (component) =>
  component.canDeactivate();
