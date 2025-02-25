// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log("Mapbox GL JS Loaded:", mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoicGFrdWFuZyIsImEiOiJjbTdpYWdhaHUwZXlhMmxvbmRvcW9ycWVlIn0.wEJEky4aDUix7mcmAi_ILw';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/mapbox/streets-v12', // Map style
    center: [-71.09415, 42.36027], // [longitude, latitude]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18 // Maximum allowed zoom
});

const sharedBikeLaneStyle = {
    'line-color': '#32D400',  // Bright green for both
    'line-width': 5,          // Thicker lines
    'line-opacity': 0.6       // Slightly less transparent
};

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stationFlow = d3.scaleQuantize()
    .domain([0, 1])   // Ratio of departures to total traffic
    .range([0, 0.5, 1]);  // Discrete values for color mapping

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);  // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point);  // Project to pixel coordinates
    return { cx: x, cy: y };  // Return as object for use in SVG attributes
  }

  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
  }


function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
        return tripsByMinute.flat(); // No filtering, return all trips
    }

    // Normalize the time range to handle midnight crossover
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;

    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}

map.on('load', async () => {
    console.log("Map fully loaded");

    // Add the Boston bike lane data source
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });

    // Add a layer to visualize the Boston bike lanes (using shared style)
    map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: sharedBikeLaneStyle
    });

    // Add the Cambridge bike lane data source
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    // Add a layer to visualize the Cambridge bike lanes (using shared style)
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: sharedBikeLaneStyle
    });

    let jsonData;
    const svg = d3.select('#map').select('svg');
    const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
    // try {
    //     const jsonData = await d3.json(jsonurl);
        
    //     console.log('Loaded JSON Data:', jsonData); // Log to verify structure
        

    // } catch (error) {
    //     console.error('Error loading JSON:', error); // Handle errors
    // }

    jsonData = await d3.json(jsonurl);

    let trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        let startedMinutes = minutesSinceMidnight(trip.started_at);
        let endedMinutes = minutesSinceMidnight(trip.ended_at);
    
        departuresByMinute[startedMinutes].push(trip);  // Store departure trip
        arrivalsByMinute[endedMinutes].push(trip);      // Store arrival trip
        return trip;
    });

    const stations = computeStationTraffic(jsonData.data.stations);

    
    const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range([0, 25]); // Min radius: 0, Max radius: 25
                // Await JSON fetch

    console.log('Updated Stations with Traffic Data:', stations);
    
    const circles = svg.selectAll('circle')
        .data(stations, (d) => d.short_name)
        .enter()
        .append('circle')
        .attr('r', 5)               // Radius of the circle
        .attr('fill', 'steelblue')  // Circle fill color
        .attr('stroke', 'white')    // Circle border color
        .attr('stroke-width', 1)    // Circle border thickness
        .attr('opacity', 0.6)     // Circle opacity
        .attr('pointer-events', 'auto')
        .attr('r', d => radiusScale(d.totalTraffic))
        .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
        .each(function (d) {
            d3.select(this)
                .append('title')
                .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });
    
            // Function to update circle positions when the map moves/zooms
        function updatePositions() {
            circles
                .attr('cx', d => getCoords(d).cx)  // Set the x-position using projected coordinates
                .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
            }



        // Select the slider and display elements
        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        let timeFilter = -1; // Default: No filtering

        // Function to update the time display when slider moves
        function updateTimeDisplay() {
            let timeFilter = Number(timeSlider.value); // Get slider value
        
            if (timeFilter === -1) {
              selectedTime.textContent = ''; // Clear time display
              anyTimeLabel.style.display = 'block'; // Show "(any time)"
            } else {
              selectedTime.textContent = formatTime(timeFilter); // Display formatted time
              anyTimeLabel.style.display = 'none'; // Hide "(any time)"
            }
            
            // Call updateScatterPlot to reflect the changes on the map
            updateScatterPlot(timeFilter);
        }

        function updateScatterPlot(timeFilter) {
            const filteredStations = computeStationTraffic(stations, timeFilter);
        
            // Dynamically adjust circle size scaling when filtering
            timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
        
            // Update the scatterplot by adjusting the radius of circles
            circles
                .data(filteredStations, (d) => d.short_name)  // Track elements correctly
                .join('circle')
                .attr('r', (d) => radiusScale(d.totalTraffic))
                .style('--departure-ratio', (d) =>
                    stationFlow(d.departures / d.totalTraffic),
                  );
        }

        // Bind slider input event to update the UI in real time
        timeSlider.addEventListener('input', updateTimeDisplay);
        // Initial position update when map loads
        updatePositions();

        // Reposition markers on map interactions
        map.on('move', updatePositions);     // Update during map movement
        map.on('zoom', updatePositions);     // Update during zooming
        map.on('resize', updatePositions);   // Update on window resize
        map.on('moveend', updatePositions);  // Final adjustment after movement ends
        // Call function once to set the default display
        updateTimeDisplay();

});

function computeStationTraffic(stations, timeFilter=-1) {
    // Retrieve filtered trips instantly
    const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter),  // Efficient filtering
        (v) => v.length,
        (d) => d.start_station_id
    );

    const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter),  // Efficient filtering
        (v) => v.length,
        (d) => d.end_station_id
    );

    // Update station data
    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}





