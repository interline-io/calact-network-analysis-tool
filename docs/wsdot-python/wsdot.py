# ERRATA: note that the KCM feed used in this analysis is a different feed than the feed in the official annual data collection file,
# due to apparent errors found in that file originally collected. File in FTSS_2024 folder is feed from mobilitydatabase fetched
# June 16 2024: https://mobilitydatabase.org/feeds/mdb-267

# this script relies on the transit_service_analyst script, which has documentation at: https://github.com/psrc/transit_service_analyst/wiki/transit_service_analyst-documentation
# The pupose of this script is to
## accept statewide GTFS feeds as input (one feed for weekdays, current reference date Monday 8/15/22, one feed for weekends, current reference Sunday 8/21/22)
## return a spreadsheet that contains all stops from those feeds, with lat/lon and binary values for each of the 6 levels of frequency designed for the Frequent Transit Service Study: https://engage.wsdot.wa.gov/frequent-transit-service-study/

import pandas as pd
import numpy as np
import transit_service_analyst as tsa
import sys

# Configuration for all service levels
SERVICE_LEVELS = {
    # 'night': {
    #     'peak': {'hours': ['hour_5', 'hour_6', 'hour_7', 'hour_8', 'hour_9', 'hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_17', 'hour_18', 'hour_19', 'hour_20', 'hour_21', 'hour_22', 'hour_23', 'hour_24', 'hour_25', 'hour_26', 'hour_27', 'hour_28'], 'min_tph': 0, 'min_total': 4},
    #     'night_segments': [
    #         {'hours': ['hour_23', 'hour_24'], 'min_total': 1},
    #         {'hours': ['hour_25', 'hour_26'], 'min_total': 1},
    #         {'hours': ['hour_27', 'hour_28'], 'min_total': 1},
    #         {'hours': ['hour_26', 'hour_27'], 'min_total': 1}
    #     ],
    #     'weekend_required': True,
    #     'level_column': 'levelNights'
    # },
    'level1': {
        'peak': {'hours': ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9'], 'min_tph': 4, 'min_total': 40},
        'extended': {'hours': ['hour_6', 'hour_7', 'hour_8', 'hour_17', 'hour_18', 'hour_19', 'hour_20', 'hour_21'], 'min_tph': 3, 'min_total': 32},
        'weekend': {'hours': ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9'], 'min_tph': 3, 'min_total': 32},
        'night_segments': [
            {'hours': ['hour_23', 'hour_24'], 'min_total': 0},
            {'hours': ['hour_25', 'hour_26'], 'min_total': 0},
            {'hours': ['hour_27', 'hour_28'], 'min_total': 0},
            {'hours': ['hour_26', 'hour_27'], 'min_total': 0}
        ],
        'weekend_required': True,
        'level_column': 'level1'
    },
    # 'level2': {
    #     'peak': {'hours': ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9'], 'min_tph': 3, 'min_total': 32},
    #     'extended': {'hours': ['hour_6', 'hour_7', 'hour_8', 'hour_17', 'hour_18', 'hour_19', 'hour_20', 'hour_21'], 'min_tph': 1, 'min_total': 16},
    #     'weekend': {'hours': ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9'], 'min_tph': 1, 'min_total': 16},
    #     'weekend_required': True,
    #     'level_column': 'level2'
    # },
    # 'level3': {
    #     'peak': {'hours': ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9'], 'min_tph': 1, 'min_total': 16},
    #     'extended': {'hours': ['hour_6', 'hour_7', 'hour_8', 'hour_17', 'hour_18', 'hour_19', 'hour_20', 'hour_21'], 'min_tph': 0, 'min_total': 8},
    #     'weekend': {'hours': ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9'], 'min_tph': 0, 'min_total': 8},
    #     'weekend_required': True,
    #     'level_column': 'level3'
    # },
    # 'level4': {
    #     'peak': {'hours': ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9'], 'min_tph': 0, 'min_total': 8},
    #     'weekend_required': False,
    #     'level_column': 'level4'
    # },
    # 'level5': {
    #     'total_trips_threshold': 6,
    #     'weekend_required': False,
    #     'level_column': 'level5'
    # },
    # 'level6': {
    #     'total_trips_threshold': 2,
    #     'weekend_required': False,
    #     'level_column': 'level6'
    # }
}

def process_night_segments(service, night_segments):
    """Process night service segments and merge results"""
    night_results = []
    
    for segment in night_segments:
        freq = service.get_tph_at_stops()
        freq['frequent_sum'] = freq[segment['hours']].sum(axis=1)
        segment_result = freq[freq['frequent_sum'] >= segment['min_total']][['stop_id']]
        night_results.append(segment_result)
    
    # Merge all night segments with inner join - only keep stop_id
    result = night_results[0]
    for night_freq in night_results[1:]:
        result = result.merge(night_freq, how='inner', on='stop_id')
    
    return result

def analyze_route_frequency(service, time_config, use_total_trips=False):
    """Analyze routes meeting frequency requirements"""
    if use_total_trips:
        all_trips = service.get_total_trips_by_line()
        frequent_routes = pd.pivot_table(all_trips, values="total_trips", 
                                       index=["route_id","direction_id"], aggfunc=np.sum)
        frequent_routes = frequent_routes[frequent_routes['total_trips'] >= time_config['threshold']]
    else:
        all_trips = service.get_tph_by_line()
        print("all trips:", all_trips)
        
        # Debug: Print trips per hour for specific route
        check_route = "KCM_100045"
        debug_route = all_trips[all_trips['route_id'] == check_route]
        if not debug_route.empty:
            print(f"\nDEBUG: Trips per hour for route {check_route}:")
            print(debug_route)
            print(f"\nDEBUG: Column names: {list(debug_route.columns)}")
            
            # Get the underlying trip data to show actual trip IDs per hour
            print(f"\nDEBUG: Getting detailed trip data for route {check_route}...")
            try:
                # Follow the same logic as get_tph_by_line() but show individual trip IDs
                first_departure = (
                    service._df_all_stops_by_trips.sort_values("stop_sequence", ascending=True)
                    .groupby("trip_id", as_index=False)
                    .first()
                )
                first_departure = first_departure.loc[(first_departure.stop_sequence == 1)]
                
                # Get trips for our specific route
                route_trips = service.trips[service.trips['route_id'] == check_route]
                route_first_departures = first_departure[first_departure['trip_id'].isin(route_trips['trip_id'])]
                
                if not route_first_departures.empty:
                    print(f"\nTrip IDs by departure hour for route {check_route}:")
                    # Group by hour and show the actual trip IDs
                    hourly_trips = route_first_departures.groupby('departure_time_hrs')['trip_id'].apply(list)
                    for hour, trip_ids in hourly_trips.items():
                        print(f"Hour {hour} (hour_{hour}): {trip_ids} ({len(trip_ids)} trips)")
                else:
                    print(f"No first departures found for route {check_route}")

            except Exception as e:
                print(f"Error accessing detailed trip data: {e}")
                print("Available service attributes:", [attr for attr in dir(service) if not attr.startswith('_')])
            
        else:
            print(f"\nDEBUG: Route {check_route} not found in all_trips data")
            print(f"Available routes: {sorted(all_trips['route_id'].unique())[:10]}...")
        
        frequent_routes = pd.pivot_table(all_trips, values=time_config['hours'], 
                                       index=["route_id","direction_id"], aggfunc=np.sum)
        print("frequent routes before filter:", frequent_routes)

        # Filter by minimum trips per hour
        for hour in time_config['hours']:
            frequent_routes = frequent_routes[frequent_routes[hour] >= time_config['min_tph']]
        print("frequent routes after hour filter:", frequent_routes)

        frequent_routes['frequent_sum'] = frequent_routes[time_config['hours']].sum(axis=1)
        frequent_routes = frequent_routes[frequent_routes['frequent_sum'] >= time_config['min_total']]
        print("frequent routes after sum check:", frequent_routes)
    
    # Get stops for these routes
    frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
    all_stops = service.get_line_stops_gdf()
    frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]
    
    ret = frequent_stops.drop_duplicates(subset=['stop_id'])
    print("frequent stops from route analysis:", ret)

    return frequent_stops

def analyze_stop_frequency(service, time_config):
    """Analyze stops meeting frequency requirements for a time period"""
    freq = service.get_tph_at_stops()
    
    # Filter by minimum trips per hour for each hour
    for hour in time_config['hours']:
        freq = freq[freq[hour] >= time_config['min_tph']]
    
    # Calculate sum and filter by minimum total
    freq['frequent_sum'] = freq[time_config['hours']].sum(axis=1)
    return freq[freq['frequent_sum'] >= time_config['min_total']]


def process_service_level(level_name, config, weekday_service, weekend_service):
    """Process a single service level and return classified stops"""
    print(f"\nProcessing {level_name}...")
    
    # Handle total trips threshold levels (5 and 6)
    if 'total_trips_threshold' in config:
        result = analyze_route_frequency(weekday_service, 
                                     {'threshold': config['total_trips_threshold']}, 
                                     use_total_trips=True)
        print(f"Final {level_name}: {len(result)} stops")
        return result
    
    # Process stop-level analysis
    stop_results = []
    
    # Peak hours analysis
    if 'peak' in config:
        peak_stops = analyze_stop_frequency(weekday_service, config['peak'])
        stop_results.append(peak_stops)
        print(f"Found {len(peak_stops)} stops meeting peak requirements")
    
    # Extended hours analysis
    if 'extended' in config:
        extended_stops = analyze_stop_frequency(weekday_service, config['extended'])
        stop_results.append(extended_stops)
        print(f"Found {len(extended_stops)} stops meeting extended requirements")
    
    # Night segments analysis
    if 'night_segments' in config:
        night_stops = process_night_segments(weekday_service, config['night_segments'])
        stop_results.append(night_stops)
        print(f"Found {len(night_stops)} stops meeting night requirements")
    
    # Merge stop-level results - only keep stop_id for merging
    if stop_results:
        merged_stops = stop_results[0][['stop_id']]
        for stops in stop_results[1:]:
            merged_stops = merged_stops.merge(stops[['stop_id']], how='inner', on='stop_id')
    else:
        merged_stops = pd.DataFrame()
    
    # Route-level analysis
    route_config = config.get('peak', config.get('extended'))
    if route_config:
        route_stops = analyze_route_frequency(weekday_service, route_config)
        print(f"Found {len(route_stops)} stops from route analysis")
        
        # Merge with stop-level results
        if not merged_stops.empty:
            result = merged_stops.merge(route_stops[['stop_id']], how='inner', on='stop_id')
        else:
            result = route_stops[['stop_id']]
    else:
        result = merged_stops
    
    # Weekend analysis if required
    if config.get('weekend_required', False) and 'weekend' in config:
        weekend_stops = analyze_stop_frequency(weekend_service, config['weekend'])
        weekend_route_stops = analyze_route_frequency(weekend_service, config['weekend'])
        
        # Merge weekend results - only keep stop_id
        weekend_merged = weekend_stops[['stop_id']].merge(weekend_route_stops[['stop_id']], how='inner', on='stop_id')
        result = result.merge(weekend_merged, how='inner', on='stop_id')
        print(f"After weekend filtering: {len(result)} stops")
    
    result = result.drop_duplicates(subset=['stop_id'])
    print(f"Final {level_name}: {len(result)} stops")
    
    return result

def main():
    """Main processing function"""
    # Check for command line argument
    if len(sys.argv) < 2:
        print("Usage: python ian_refactored.py <output_filename.csv> <monday_dir> <sunday_dir>")
        sys.exit(1)
    
    output_filename = sys.argv[1]
    
    # user must separately merge gtfs files before use of this notebook: 
    # combine_gtfs_feeds run -g C:\Users\craigth\pythonwork\FTSS_2024\2024 -s 20240819 -o C:\Users\craigth\pythonwork\FTSS_2024\monday-3
    # combine_gtfs_feeds run -g C:\Users\craigth\pythonwork\FTSS_2024\2024 -s 20240825 -o C:\Users\craigth\pythonwork\FTSS_2024\sunday-3

    # import GTFS feeds
    ## weekday feed
    path = sys.argv[2] # r'gtfs/monday-3'
    weekday_service = tsa.load_gtfs(path, '20240819')
    ## weekend feed
    path1 = sys.argv[3] # r'gtfs/sunday-3'
    weekend_service = tsa.load_gtfs(path1, '20240825')

    # Process all service levels
    results = {}
    for level_name, config in SERVICE_LEVELS.items():
        results[level_name] = process_service_level(level_name, config, weekday_service, weekend_service)

    # Prepare final output
    output_data = []

    # Add level indicators to each result
    for level_name, config in SERVICE_LEVELS.items():
        df = results[level_name][['stop_id']].copy()
        df[config['level_column']] = '1'
        output_data.append(df)

    # Get stop coordinates
    stops = weekday_service.stops[["stop_id", "stop_lat", "stop_lon"]]

    # Merge all results
    final_result = stops
    for df in output_data:
        final_result = final_result.merge(df, how='outer', on='stop_id')

    # Reorder columns to match required header order (without the index column)
    column_order = ['stop_id', 'level6', 'level5', 'level4', 'level3', 'level2', 'level1', 'levelNights', 'stop_lat', 'stop_lon']
    final_result = final_result.reindex(columns=column_order)

    # Save with index=True to include the integer index starting at 0
    final_result.to_csv(output_filename, index=False)
    print(f"\nFinal output: {len(final_result)} total stops written to {output_filename}")

if __name__ == "__main__":
    main()
