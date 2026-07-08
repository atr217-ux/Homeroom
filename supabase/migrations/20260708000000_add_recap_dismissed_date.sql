-- Track the last date the user dismissed the daily recap modal so that seeing
-- it on one device suppresses it on the others until tomorrow.
alter table profiles
  add column if not exists last_recap_dismissed_date date;
