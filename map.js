import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoiZGpuYWlyIiwiYSI6ImNtaHk3NGtkMzBhNWQya3B4ajMwZmozZzUifQ.Apdyb-5SD37WUOPRja_qHA';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

map.addControl(new mapboxgl.NavigationControl());

const svg = d3.select('#map').append('svg')
  .style('position', 'absolute')
  .style('z-index', 2)
  .style('width', '100%')
  .style('height', '100%')
  .style('pointer-events', 'none'); 

function getCoords(station) {
  const lon = station.Long ?? station.lon ?? station.longitude ?? station.long;
  const lat = station.Lat ?? station.lat ?? station.latitude;
  const point = new mapboxgl.LngLat(+lon, +lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    return tripsByMinute.slice(minMinute).concat(tripsByMinute.slice(0, maxMinute)).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(filterByMinute(departuresByMinute, timeFilter), v => v.length, d => d.start_station_id);
  const arrivals = d3.rollup(filterByMinute(arrivalsByMinute, timeFilter), v => v.length, d => d.end_station_id);

  return stations.map(station => {
    const id = station.short_name ?? station.Number ?? station.station_id ?? station.id;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    station.balance = station.totalTraffic === 0
        ? 0
        : (station.arrivals - station.departures) / station.totalTraffic;
    return station;
  });
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: { 'line-color': '#32D400', 'line-width': 3, 'line-opacity': 0.6 }
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/resource/7cp3-r77j.geojson'
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: { 'line-color': '#0077CC', 'line-width': 3, 'line-opacity': 0.6 }
  });

  const stationsData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  let stations = stationsData.data.stations;

  await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', trip => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);

    const startMin = minutesSinceMidnight(trip.started_at);
    const endMin = minutesSinceMidnight(trip.ended_at);

    departuresByMinute[startMin].push(trip);
    arrivalsByMinute[endMin].push(trip);

    return trip;
  });

  stations = computeStationTraffic(stations, -1);
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic) || 1])
    .range([0, 25]);

  const colorScale = d3.scaleDiverging()
    .domain([-1, 0, 1])
    .range(["darkblue", "hotpink", "goldenrod"]);

  let circles = svg.selectAll('circle')
    .data(stations, d => d.short_name ?? d.Number ?? d.station_id)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', d => colorScale(d.balance))
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .style('pointer-events', 'auto')
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

  function updatePositions() {
    svg.selectAll('circle')
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  updatePositions();

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    (timeFilter === -1) ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    svg.selectAll('circle')
      .data(filteredStations, d => d.short_name ?? d.Number ?? d.station_id)
      .join(
        enter => enter.append('circle')
          .attr('r', d => radiusScale(d.totalTraffic))
          .attr('stroke', 'white')
          .attr('stroke-width', 1)
          .attr('opacity', 0.8)
          .style('pointer-events', 'auto')
          .each(function (d) {
            d3.select(this).append('title').text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
          }),
        update => update
          .attr('r', d => radiusScale(d.totalTraffic))
          .attr('fill', d => colorScale(d.balance)) 
          .each(function (d) {
            d3.select(this).select('title').text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
          }),
        exit => exit.remove()
      );
    updatePositions();
  }

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }
  if (timeSlider) {
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
  } else {
    console.warn('Time slider not found in DOM (ID: time-slider).');
  }
});