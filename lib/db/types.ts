export type Profile = {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
};

export type HomeroomStatus = "scheduled" | "active" | "completed";

export type Homeroom = {
  id: string;
  created_by: string;
  title: string;
  is_private: boolean;
  duration: number;
  status: HomeroomStatus;
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  squad_tags: string[];
  created_at: string;
  // Joined fields
  profiles?: { username: string; avatar: string | null };
};

export type HomeroomParticipant = {
  homeroom_id: string;
  user_id: string;
  joined_at: string;
  profiles?: { username: string; avatar: string | null };
};

export type HomeroomInvite = {
  id: string;
  homeroom_id: string;
  from_user: string;
  to_user: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  homerooms?: Homeroom;
  from_profile?: { username: string; avatar: string | null };
};

export type Task = {
  id: string;
  user_id: string;
  text: string;
  done: boolean;
  time_spent: number; // seconds
  homeroom_id: string | null;
  sort_order: number;
  created_at: string;
  completed_at: string | null;
};
