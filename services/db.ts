import Dexie, { Table } from 'dexie';
import { StravaActivity } from '../types';

export class StravaDatabase extends Dexie {
  activities!: Table<StravaActivity, number>;

  constructor() {
    super('ActivityTrendDB');
    // Fix: Cast this to any to avoid TS error "Property 'version' does not exist on type 'StravaDatabase'"
    (this as any).version(1).stores({
      activities: 'id, type, start_date, distance, [type+start_date]'
    });
  }
}

export const db = new StravaDatabase();

export const saveActivities = async (activities: StravaActivity[]) => {
  await db.activities.bulkPut(activities);
};

export const getAllActivities = async (): Promise<StravaActivity[]> => {
  return await db.activities.orderBy('start_date').reverse().toArray();
};

export const clearDatabase = async () => {
  await db.activities.clear();
};