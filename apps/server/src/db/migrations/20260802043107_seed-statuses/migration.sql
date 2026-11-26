-- Custom SQL migration file, put your code below! --

INSERT INTO statuses (name, description, percentage) VALUES ('To Do', 'Work has not yet started on this track.', 0);
INSERT INTO statuses (name, description, percentage) VALUES ('In Progress', 'This track is currently being worked on.',
                                                             50);
INSERT INTO statuses (name, description, percentage) VALUES ('Complete', 'This track is complete.', 100);
