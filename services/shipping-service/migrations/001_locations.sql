CREATE SCHEMA IF NOT EXISTS shipping;
CREATE TABLE shipping.metadata (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE shipping.countries (code varchar(2) PRIMARY KEY, name text NOT NULL);
CREATE TABLE shipping.cities (
  id integer PRIMARY KEY,
  country_code varchar(2) NOT NULL REFERENCES shipping.countries(code),
  name text NOT NULL,
  search_name text COLLATE "C" NOT NULL,
  region text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180)
);
CREATE INDEX city_search ON shipping.cities(country_code, search_name, id);
