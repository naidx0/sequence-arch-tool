import { app } from 'electron';
import { describeMigration, prepareUserData } from './userDataMigration';

/*
 * FIRST IMPORT OF main.ts. Imports run in order, so this settles the userData folder before any other module can read a path.
 */
export const userDataMigration = prepareUserData(app);
export const userDataMigrationNote = describeMigration(userDataMigration);
