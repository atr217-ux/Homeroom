export type Profile = {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
};

export type Tag = {
  id: string;
  name: string;
};

export type Task = {
  id: string;
  user_id: string;
  text: string;
  done: boolean;
  is_private: boolean;
  time_spent: number;             // seconds
  timer_started_at: string | null;
  block_id: string | null;
  is_shared: boolean;
  claimed_by_user_id: string | null;
  completed_by_user_id: string | null;
  completed_at: string | null;
  committed_for_date: string | null; // YYYY-MM-DD
  created_at: string;
};

export type TaskWithTags = Task & {
  task_tags?: { tag_id: string; tags: { id: string; name: string } | null }[];
};

export type BlockVisibility = "private" | "shared" | "public";

export type Block = {
  id: string;
  user_id: string;
  date: string;                  // YYYY-MM-DD
  name: string;
  start_time: string | null;     // "HH:MM:SS"
  end_time: string | null;
  visibility: BlockVisibility;
  is_live: boolean;
  position: number;
  created_at: string;
};

export type BlockInviteStatus = "invited" | "joined" | "declined";

export type BlockInvite = {
  id: string;
  block_id: string;
  invited_user_id: string;
  status: BlockInviteStatus;
  created_at: string;
};

export type Squad = {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  is_public: boolean;
  member_count: number;
  created_by: string;
};

export type Friendship = {
  user_a: string;
  user_b: string;
  created_at: string;
};

// Row shape emitted by the home/feed query
export type FeedEventRow = Task & {
  profiles?: { username: string; avatar: string | null };
  blocks?: { id: string; name: string; start_time: string | null; end_time: string | null } | null;
};
