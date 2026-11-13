CREATE ROLE ldms_app LOGIN PASSWORD 'dev_app_pw';
ALTER ROLE ldms_owner CREATEDB;
CREATE DATABASE ldms_test OWNER ldms_owner;
