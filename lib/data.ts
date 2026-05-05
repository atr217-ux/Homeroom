export type Room = {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  count: number;
};

export type User = {
  id: number;
  handle: string;
  initials: string;
  color: string;
  duration: number;
  elapsed: number;
  tasks: number;
  done: number;
  sharing: boolean;
  friend: boolean;
  squad: string | null;
};

export const ROOMS: Room[] = [];

export const USERS: User[] = [];
