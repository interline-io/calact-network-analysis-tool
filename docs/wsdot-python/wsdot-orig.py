# ERRATA: note that the KCM feed used in this analysis is a different feed than the feed in the official annual data collection file,
# due to apparent errors found in that file originally collected. File in FTSS_2024 folder is feed from mobilitydatabase fetched
# June 16 2024: https://mobilitydatabase.org/feeds/mdb-267

# this script relies on the transit_service_analyst script, which has documentation at: https://github.com/psrc/transit_service_analyst/wiki/transit_service_analyst-documentation
# The pupose of this script is to
## accept statewide GTFS feeds as input (one feed for weekdays, current reference date Monday 8/15/22, one feed for weekends, current reference Sunday 8/21/22)
## return a spreadsheet that contains all stops from those feeds, with lat/lon and binary values for each of the 6 levels of frequency designed for the Frequent Transit Service Study: https://engage.wsdot.wa.gov/frequent-transit-service-study/

#import necessary libraries
import sys
import pandas as pd
import numpy as np
import transit_service_analyst as tsa

# Set display options to show all rows and columns
pd.set_option('display.max_rows', None)
pd.set_option('display.max_columns', None)
pd.set_option('display.width', None)
pd.set_option('display.max_colwidth', None)

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

# define time windows
peak_hours = ['hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_9']
extended_hours = ['hour_6', 'hour_7', 'hour_8', 'hour_17', 'hour_18', 'hour_19', 'hour_20', 'hour_21']
night_hours = ['hour_5', 'hour_22', 'hour_23', 'hour_24', 'hour_25', 'hour_26', 'hour_27', 'hour_28']
all_hours =  ['hour_6', 'hour_7', 'hour_8', 'hour_9', 'hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_17', 'hour_18', 'hour_19', 'hour_20', 'hour_21']
hours = ['hour_5', 'hour_6', 'hour_7', 'hour_8', 'hour_9', 'hour_10', 'hour_11', 'hour_12', 'hour_13', 'hour_14', 'hour_15', 'hour_16', 'hour_17', 'hour_18', 'hour_19', 'hour_20', 'hour_21', 'hour_22', 'hour_23', 'hour_24', 'hour_25', 'hour_26', 'hour_27', 'hour_28']
night_hours_1 = ['hour_23', 'hour_24']
night_hours_2 = ['hour_25', 'hour_26']
night_hours_3 = ['hour_27', 'hour_28']
night_hours_4 = ['hour_26', 'hour_27']

# set variables: set the minimum number of arrivals per hour and total during each time period
## 24HourService
min_tph_Night_peak = 0
min_tph_Night_peak_24hour = 4
min_tph_Night = 1
## Level1
min_tph_0_peak = 4
min_tph_0_peak_8hour = 40
min_tph_0_ext = 3
min_tph_0_ext_8hour = 32
min_tph_0_end = 3
min_tph_0_end_8hour = 32
min_tph_0_Night = 0
## Level2
min_tph_7_peak = 3
min_tph_7_peak_8hour = 32
min_tph_7_ext = 1
min_tph_7_ext_8hour = 16
min_tph_7_end = 1
min_tph_7_end_8hour = 16
## Level3
min_tph_2_peak = 1
min_tph_2_peak_8hour = 16
min_tph_2_ext = 0
min_tph_2_ext_8hour = 8
min_tph_2_end = 0
min_tph_2_end_8hour = 8
## Level4
min_tph_3_peak = 0
min_tph_3_peak_8hour = 8
## Level5
min_tph_4_24hour = 6
## Level6
min_tph_5_24hour = 2

## find stop_ids for layer NIGHT

LEVELS = set(['levelNights', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6'])

# identify stops with service in all hours
# if 'levelNights' in LEVELS:
freqNight = weekday_service.get_tph_at_stops() 
cols = []
for hour in hours:
    freqNight = freqNight[freqNight[hour]>=min_tph_Night_peak]
    freqNight['frequent_sum'] = freqNight[hours].sum(axis=1)
freqNight_ = freqNight[freqNight['frequent_sum']>=min_tph_Night_peak_24hour]

# identify stops with service in night segment 1
freqNight1 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_1:
    freqNight1['frequent_sum'] = freqNight1[night_hours_1].sum(axis=1)
freqNight1 = freqNight1[freqNight1['frequent_sum']>=min_tph_Night]

# identify stops with service in night segment 2
freqNight2 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_2:
    freqNight2['frequent_sum'] = freqNight2[night_hours_2].sum(axis=1)
freqNight2 = freqNight2[freqNight2['frequent_sum']>=min_tph_Night]

# identify stops with service in night segment 3
freqNight3 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_3:
    freqNight3['frequent_sum'] = freqNight3[night_hours_3].sum(axis=1)
freqNight3 = freqNight3[freqNight3['frequent_sum']>=min_tph_Night]

# identify stops with service in night segment 4
freqNight4 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_4:
    freqNight4['frequent_sum'] = freqNight4[night_hours_4].sum(axis=1)
freqNight4 = freqNight4[freqNight4['frequent_sum']>=min_tph_Night]

# merge all above
freqNight = freqNight_.merge(freqNight1, how = 'inner', on = 'stop_id')
freqNight = freqNight.merge(freqNight2, how = 'inner', on = 'stop_id')
freqNight = freqNight.merge(freqNight3, how = 'inner', on = 'stop_id')
freqNight = freqNight.merge(freqNight4, how = 'inner', on = 'stop_id')

# aggregate headway of trips into routes by direction
all_trips = weekday_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement
# at peak hours
cols = []
for hour in hours:
    frequent_routes0 = frequent_routes[frequent_routes[hour]>=min_tph_Night_peak]
frequent_routes0['frequent_sum'] = frequent_routes0[hours].sum(axis=1)
frequent_routes = frequent_routes0[frequent_routes0['frequent_sum']>=min_tph_Night_peak_24hour]
# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekday_service.get_line_stops_gdf()
frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]

# merge to list from stop-level process
frequent_stopsNights = freqNight.merge(frequent_stops, how = 'inner', on = 'stop_id')
frequent_stopsNights = frequent_stopsNights.drop_duplicates(subset=['stop_id'])

# identify stops with service in weekend hours
freqNightw = weekend_service.get_tph_at_stops() 
cols = []
for hour in hours:
    freqNightw = freqNightw[freqNightw[hour]>=min_tph_Night_peak]
    freqNightw['frequent_sum'] = freqNightw[hours].sum(axis=1)
freqNightw = freqNightw[freqNightw['frequent_sum']>=min_tph_Night_peak_24hour]

# identify stops with service in night segment 1
freqNightw1 = weekend_service.get_tph_at_stops() 
cols = []
for hour in night_hours_1:
    freqNightw1['frequent_sum'] = freqNightw1[night_hours_1].sum(axis=1)
freqNightw1 = freqNightw1[freqNightw1['frequent_sum']>=min_tph_Night]

# identify stops with service in night segment 2
freqNightw2 = weekend_service.get_tph_at_stops() 
cols = []
for hour in night_hours_2:
    freqNightw2['frequent_sum'] = freqNightw2[night_hours_2].sum(axis=1)
freqNightw2 = freqNightw2[freqNightw2['frequent_sum']>=min_tph_Night]

# identify stops with service in night segment 3
freqNightw3 = weekend_service.get_tph_at_stops() 
cols = []
for hour in night_hours_3:
    freqNightw3['frequent_sum'] = freqNightw3[night_hours_3].sum(axis=1)
freqNightw3 = freqNightw3[freqNightw3['frequent_sum']>=min_tph_Night]

# identify stops with service in night segment 4
freqNightw4 = weekend_service.get_tph_at_stops() 
cols = []
for hour in night_hours_4:
    freqNightw4['frequent_sum'] = freqNightw4[night_hours_4].sum(axis=1)
freqNightw4 = freqNightw4[freqNightw4['frequent_sum']>=min_tph_Night]

# merge all above
freqNightw = freqNightw.merge(freqNightw1, how = 'inner', on = 'stop_id')
freqNightw = freqNightw.merge(freqNightw2, how = 'inner', on = 'stop_id')
freqNightw = freqNightw.merge(freqNightw3, how = 'inner', on = 'stop_id')
freqNightw = freqNightw.merge(freqNightw4, how = 'inner', on = 'stop_id')

# merge to list from weekday/route-level process
frequent_stopsNights = freqNightw.merge(frequent_stopsNights, how = 'inner', on = 'stop_id')
frequent_stopsNights = frequent_stopsNights.drop_duplicates(subset=['stop_id'])

# aggregate headway of trips into routes by direction
all_trips = weekend_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement on weekends during peak
cols = []
for hour in hours:
    frequent_routes = frequent_routes[frequent_routes[hour]>=min_tph_Night_peak]
frequent_routes['frequent_sum'] = frequent_routes[hours].sum(axis=1)
frequent_routes = frequent_routes[frequent_routes['frequent_sum']>=min_tph_Night_peak_24hour]
    
# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekend_service.get_line_stops_gdf()
frequent_stopsNightsw = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]

# merge to list from previous processes
frequent_stopsNights = frequent_stopsNights.merge(frequent_stopsNightsw, how = 'inner', on = 'stop_id')
frequent_stopsNights = frequent_stopsNights.drop_duplicates(subset=['stop_id'])

#print series of human readable sentences revealing how many stops were in each dataframe above
print (f'There are {len(freqNight_)} stops that have {min_tph_Night_peak} trips or more per hour 24 hours per day.')
print (f'There are {len(freqNight1)} stops that have service between 11 and 1 on weekdays.')
print (f'There are {len(freqNight2)} stops that have service between 1 and 3 on weekdays.')
print (f'There are {len(freqNight3)} stops that have service between 3 and 5 on weekdays.')
print (f'There are {len(freqNight4)} stops that have service between 3 and 5 on weekdays.')
print (f'There are {len(frequent_stops)} stops associated with routes that have {min_tph_Night_peak} or more trips per hour 24 hours per day.')
print (f'There are {len(freqNightw)} stops that have {min_tph_Night_peak} trips or more per hour 24 hours per day on Sundays.')
print (f'There are {len(freqNightw1)} stops that have service between 11 and 1 on weekends.')
print (f'There are {len(freqNightw2)} stops that have service between 1 and 3 on weekends.')
print (f'There are {len(freqNightw3)} stops that have service between 3 and 5 on weekends.')
print (f'There are {len(freqNightw4)} stops that have service between 3 and 5 on weekends.')
print (f'There are {len(frequent_stopsNightsw)} stops associated with routes that have {min_tph_Night_peak} or more trips per hour 24 hours per day on Sundays.')
print (f'There are {len(frequent_stopsNights)} stops that meet all criteria.')
print(set(frequent_stopsNights['stop_id'].tolist()))

## find stop_ids for Level1

# identify stops with service in peak hours
# if 'level1' in LEVELS:
freq0 = weekday_service.get_tph_at_stops() 
cols = []
for hour in peak_hours:
    freq0 = freq0[freq0[hour]>=min_tph_0_peak]
    freq0['frequent_sum'] = freq0[peak_hours].sum(axis=1)
freq0 = freq0[freq0['frequent_sum']>=min_tph_0_peak_8hour]

# identify stops with service in extended hours
freq0a = weekday_service.get_tph_at_stops()
cols = []
for hour in extended_hours:
    freq0a = freq0a[freq0a[hour]>=min_tph_0_ext]
    freq0a['frequent_sum'] = freq0a[extended_hours].sum(axis=1)
freq0a = freq0a[freq0a['frequent_sum']>=min_tph_0_ext_8hour]

# identify stops with service in night segment 1
freqNight1 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_1:
    freqNight1['frequent_sum'] = freqNight1[night_hours_1].sum(axis=1)
freqNight1 = freqNight1[freqNight1['frequent_sum']>=min_tph_0_Night]

# identify stops with service in night segment 2
freqNight2 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_2:
    freqNight2['frequent_sum'] = freqNight2[night_hours_2].sum(axis=1)
freqNight2 = freqNight2[freqNight2['frequent_sum']>=min_tph_0_Night]

# identify stops with service in night segment 3
freqNight3 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_3:
    freqNight3['frequent_sum'] = freqNight3[night_hours_3].sum(axis=1)
freqNight3 = freqNight3[freqNight3['frequent_sum']>=min_tph_0_Night]

# identify stops with service in night segment 4
freqNight4 = weekday_service.get_tph_at_stops() 
cols = []
for hour in night_hours_4:
    freqNight4['frequent_sum'] = freqNight4[night_hours_4].sum(axis=1)
freqNight4 = freqNight4[freqNight4['frequent_sum']>=min_tph_0_Night]

# merge to identify stops that are in both groups
freq0a = freq0a.merge(freqNight1, how = 'inner', on = 'stop_id')
freq0a = freq0a.merge(freqNight2, how = 'inner', on = 'stop_id')
freq0a = freq0a.merge(freqNight3, how = 'inner', on = 'stop_id')
freq0a = freq0a.merge(freqNight4, how = 'inner', on = 'stop_id')
freq0f = freq0.merge(freq0a, how = 'inner', on = 'stop_id')
freq0f = freq0f.drop_duplicates(subset=['stop_id'])

# aggregate headway of trips into routes by direction
all_trips = weekday_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=all_hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement
# at peak hours
cols = []
for hour in peak_hours:
    frequent_routes0 = frequent_routes[frequent_routes[hour]>=min_tph_0_peak]
frequent_routes0['frequent_sum'] = frequent_routes0[peak_hours].sum(axis=1)
frequent_routes0 = frequent_routes0[frequent_routes0['frequent_sum']>=min_tph_0_peak_8hour]
# during extended hours
cols = []
for hour in extended_hours:
    frequent_routes0a = frequent_routes[frequent_routes[hour]>=min_tph_0_ext]
frequent_routes0a['frequent_sum'] = frequent_routes0a[extended_hours].sum(axis=1)
frequent_routes0a = frequent_routes0a[frequent_routes0a['frequent_sum']>=min_tph_0_ext_8hour]
# identify trips associated with those routes
frequent_routes = frequent_routes0a.merge(frequent_routes0, how='inner', on='route_id')
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekday_service.get_line_stops_gdf()
frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]

# merge to list from stop-level process
frequent_stops0 = freq0f.merge(frequent_stops, how = 'inner', on = 'stop_id')
frequent_stops0 = frequent_stops0.drop_duplicates(subset=['stop_id'])

# identify stops with service in weekend hours
freq0w = weekend_service.get_tph_at_stops() 
cols = []
for hour in peak_hours:
    freq0w = freq0w[freq0w[hour]>=min_tph_0_end]
    freq0w['frequent_sum'] = freq0w[peak_hours].sum(axis=1)
freq0w = freq0w[freq0w['frequent_sum']>=min_tph_0_end_8hour]
    
# merge to list from weekday/route-level process
frequent_stops0 = freq0w.merge(frequent_stops0, how = 'inner', on = 'stop_id')
frequent_stops0 = frequent_stops0.drop_duplicates(subset=['stop_id'])

# aggregate headway of trips into routes by direction
all_trips = weekend_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=peak_hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement on weekends during peak
cols = []
for hour in peak_hours:
    frequent_routes = frequent_routes[frequent_routes[hour]>=min_tph_0_end]
frequent_routes['frequent_sum'] = frequent_routes[peak_hours].sum(axis=1)
frequent_routes = frequent_routes[frequent_routes['frequent_sum']>=min_tph_0_end_8hour]
    
# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekend_service.get_line_stops_gdf()
frequent_stops0w = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]

# merge to list from previous processes
frequent_stops0 = frequent_stops0.merge(frequent_stops0w, how = 'inner', on = 'stop_id')
frequent_stops0 = frequent_stops0.drop_duplicates(subset=['stop_id'])

#print series of human readable sentences revealing how many stops were in each dataframe above
print (f'There are {len(freq0)} stops that have {min_tph_0_peak} trips or more per hour during peak.')
print (f'There are {len(freq0a)} stops that have {min_tph_0_ext} trips or more per hour during extended hours.')
print (f'There are {len(freqNight1)} stops that have service between 11 and 1 on weekdays.')
print (f'There are {len(freqNight2)} stops that have service between 1 and 3 on weekdays.')
print (f'There are {len(freqNight3)} stops that have service between 3 and 5 on weekdays.')
print (f'There are {len(freqNight4)} stops that have service between 3 and 5 on weekdays.')
print (f'There are {len(frequent_stops)} stops associated with routes that have {min_tph_0_peak} or more trips per hour during the day and {min_tph_0_ext} trips or more per hour during all hours.')
print (f'There are {len(freq0w)} stops that have {min_tph_0_end} trips or more on Sundays.')
print (f'There are {len(frequent_stops0w)} stops associated with routes that have {min_tph_0_end} or more trips per hour during the weekends.')
print (f'There are {len(frequent_stops0)} stops that meet all criteria.')
print(set(frequent_stops0['stop_id'].tolist()))

## find stop_ids for Level2
# if 'level2' in LEVELS:
# identify stops with service in peak hours
freq7 = weekday_service.get_tph_at_stops() 
cols = []
for hour in peak_hours:
    freq7 = freq7[freq7[hour]>=min_tph_7_peak]
    freq7['frequent_sum'] = freq7[peak_hours].sum(axis=1)
freq7 = freq7[freq7['frequent_sum']>=min_tph_7_peak_8hour]

# identify stops with service in extended hours
freq7a = weekday_service.get_tph_at_stops()
cols = []
for hour in extended_hours:
    freq7a = freq7a[freq7a[hour]>=min_tph_7_ext]
    freq7a['frequent_sum'] = freq7a[extended_hours].sum(axis=1)
freq7a = freq7a[freq7a['frequent_sum']>=min_tph_7_ext_8hour]
        
# merge to identify stops that are in both groups
freq7f = freq7.merge(freq7a, how = 'inner', on = 'stop_id')
freq7f = freq7f.drop_duplicates(subset=['stop_id'])

# aggregate headway of trips into routes by direction
all_trips = weekday_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=all_hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement
# at peak hours
cols = []
for hour in peak_hours:
    frequent_routes0 = frequent_routes[frequent_routes[hour]>=min_tph_7_peak]
frequent_routes0['frequent_sum'] = frequent_routes0[peak_hours].sum(axis=1)

# print("FREQUENT ROUTES AFTER PEAK HOUR FILTERING:")
# print(frequent_routes0)

frequent_routes0 = frequent_routes0[frequent_routes0['frequent_sum']>=min_tph_7_peak_8hour]
# print("FREQUENT ROUTES AFTER PEAK HOUR TOTAL FILTERING:")
# print(frequent_routes0)
# print(frequent_routes0.index.get_level_values('route_id').unique().tolist())

# during extended hours
cols = []
for hour in extended_hours:
    frequent_routes0a = frequent_routes[frequent_routes[hour]>=min_tph_7_ext]
frequent_routes0a['frequent_sum'] = frequent_routes0a[extended_hours].sum(axis=1)
# print("FREQUENT ROUTES AFTER EXTENDED HOUR FILTERING:")
# print(frequent_routes0a)

frequent_routes0a = frequent_routes0a[frequent_routes0a['frequent_sum']>=min_tph_7_ext_8hour]
# print("FREQUENT ROUTES AFTER EXTENDED HOUR TOTAL FILTERING:")
# print(frequent_routes0a)
# print(frequent_routes0a.index.get_level_values('route_id').unique().tolist())

# identify trips associated with those routes
frequent_routes = frequent_routes0a.merge(frequent_routes0, how='inner', on='route_id')
# print("FREQUENT ROUTES AFTER MERGING PEAK AND EXTENDED:")
# print(frequent_routes)
# print(frequent_routes.index.get_level_values('route_id').unique().tolist())

frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekday_service.get_line_stops_gdf()
frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]
# print("FREQUENT STOPS FROM BOTH ROUTE CONFIGS MERGED:")
# print(len(set(frequent_stops['stop_id'].tolist())))
# print(set(frequent_stops['stop_id'].tolist()))

# merge to list from stop-level process
frequent_stops7 = freq7f.merge(frequent_stops, how = 'inner', on = 'stop_id')
frequent_stops7 = frequent_stops7.drop_duplicates(subset=['stop_id'])
# print("Frequent stops after merging stop level and route level:")
# print(len(set(frequent_stops7['stop_id'].tolist())))
# print(set(frequent_stops7['stop_id'].tolist()))

# identify stops with service in weekend hours
freq7w = weekend_service.get_tph_at_stops() 
cols = []
for hour in peak_hours:
    freq7w = freq7w[freq7w[hour]>=min_tph_7_end]
    freq7w['frequent_sum'] = freq7w[peak_hours].sum(axis=1)
freq7w = freq7w[freq7w['frequent_sum']>=min_tph_7_end_8hour]
# print("Stops meeting weekend hour criteria")
# print(len(set(freq7w['stop_id'].tolist())))
# print(set(freq7w['stop_id'].tolist()))        

# merge to list from weekday/route-level process
frequent_stops7 = freq7w.merge(frequent_stops7, how = 'inner', on = 'stop_id')
frequent_stops7 = frequent_stops7.drop_duplicates(subset=['stop_id'])
# print("...after merging with previous frequent stops")
# print(len(set(frequent_stops7['stop_id'].tolist())))
# print(set(frequent_stops7['stop_id'].tolist()))    

# aggregate headway of trips into routes by direction
all_trips = weekend_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=peak_hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement on weekends during peak
cols = []
for hour in peak_hours:
    frequent_routes = frequent_routes[frequent_routes[hour]>=min_tph_7_end]
frequent_routes['frequent_sum'] = frequent_routes[peak_hours].sum(axis=1)
frequent_routes = frequent_routes[frequent_routes['frequent_sum']>=min_tph_7_end_8hour]

# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekend_service.get_line_stops_gdf()
frequent_stops7w = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]
# print("Stops on routes meeting weekend criteria")
# print(len(set(frequent_stops7w['stop_id'].tolist())))
# print(set(frequent_stops7w['stop_id'].tolist()))

# merge to list from previous processes
frequent_stops7 = frequent_stops7.merge(frequent_stops7w, how = 'inner', on = 'stop_id')
frequent_stops7 = frequent_stops7.drop_duplicates(subset=['stop_id'])
# print("...after merging with previous frequent stops")
# print(len(set(frequent_stops7['stop_id'].tolist())))
# print(set(frequent_stops7['stop_id'].tolist()))    

#print series of human readable sentences revealing how many stops were in each dataframe above
print (f'There are {len(freq7)} stops that have {min_tph_7_peak} trips or more per hour during peak.')
print (f'There are {len(freq7a)} stops that have {min_tph_7_ext} trips or more per hour during extended hours.')
print (f'There are {len(frequent_stops)} stops associated with routes that have {min_tph_7_peak} or more trips per hour during the day and {min_tph_7_ext} trips or more per hour during all hours.')
print (f'There are {len(freq7w)} stops that have {min_tph_7_end} trips or more on Sundays.')
print (f'There are {len(frequent_stops7w)} stops associated with routes that have {min_tph_7_end} or more trips per hour during the weekends.')
print (f'There are {len(frequent_stops7)} stops that meet all criteria.')
print(set(frequent_stops7['stop_id'].tolist()))

## find stop_ids for Level3
# if 'level3' in LEVELS:
# identify stops with service in peak hours
freq2 = weekday_service.get_tph_at_stops() 
cols = []
for hour in peak_hours:
    freq2 = freq2[freq2[hour]>=min_tph_2_peak]
    freq2['frequent_sum'] = freq2[peak_hours].sum(axis=1)
freq2 = freq2[freq2['frequent_sum']>=min_tph_2_peak_8hour]

# identify stops with service in extended hours
freq2a = weekday_service.get_tph_at_stops()
cols = []
for hour in extended_hours:
    freq2a = freq2a[freq2a[hour]>=min_tph_2_ext]
    freq2a['frequent_sum'] = freq2a[extended_hours].sum(axis=1)
freq2a = freq2a[freq2a['frequent_sum']>=min_tph_2_ext_8hour]
        
# merge to identify stops that are in both groups
freq2f = freq2.merge(freq2a, how = 'inner', on = 'stop_id')
freq2f = freq2f.drop_duplicates(subset=['stop_id'])

# aggregate headway of trips into routes by direction
all_trips = weekday_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=all_hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement
# at peak hours
cols = []
for hour in peak_hours:
    frequent_routes0 = frequent_routes[frequent_routes[hour]>=min_tph_2_peak]
frequent_routes0['frequent_sum'] = frequent_routes0[peak_hours].sum(axis=1)
frequent_routes0 = frequent_routes0[frequent_routes0['frequent_sum']>=min_tph_2_peak_8hour]
# during extended hours
cols = []
for hour in extended_hours:
    frequent_routes0a = frequent_routes[frequent_routes[hour]>=min_tph_2_ext]
frequent_routes0a['frequent_sum'] = frequent_routes0a[extended_hours].sum(axis=1)
frequent_routes0a = frequent_routes0a[frequent_routes0a['frequent_sum']>=min_tph_2_ext_8hour]
# identify trips associated with those routes
frequent_routes = frequent_routes0a.merge(frequent_routes0, how='inner', on='route_id')
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekday_service.get_line_stops_gdf()
frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]

# merge to list from stop-level process
frequent_stops2 = freq2f.merge(frequent_stops, how = 'inner', on = 'stop_id')
frequent_stops2 = frequent_stops2.drop_duplicates(subset=['stop_id'])

# identify stops with service in weekend hours
freq2w = weekend_service.get_tph_at_stops() 
cols = []
for hour in peak_hours:
    freq2w = freq2w[freq2w[hour]>=min_tph_2_end]
    freq2w['frequent_sum'] = freq2w[peak_hours].sum(axis=1)
freq2w = freq2w[freq2w['frequent_sum']>=min_tph_2_end_8hour]
    
# merge to list from weekday/route-level process
frequent_stops2 = freq2w.merge(frequent_stops2, how = 'inner', on = 'stop_id')
frequent_stops2 = frequent_stops2.drop_duplicates(subset=['stop_id'])

# aggregate headway of trips into routes by direction
all_trips = weekend_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=peak_hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement on weekends during peak
cols = []
for hour in peak_hours:
    frequent_routes = frequent_routes[frequent_routes[hour]>=min_tph_2_end]
frequent_routes['frequent_sum'] = frequent_routes[peak_hours].sum(axis=1)
frequent_routes = frequent_routes[frequent_routes['frequent_sum']>=min_tph_2_end_8hour]
    
# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekend_service.get_line_stops_gdf()
frequent_stops2w = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]

# merge to list from previous processes
frequent_stops2 = frequent_stops2.merge(frequent_stops2w, how = 'inner', on = 'stop_id')
frequent_stops2 = frequent_stops2.drop_duplicates(subset=['stop_id'])

#print series of human readable sentences revealing how many stops were in each dataframe above
print (f'There are {len(freq2)} stops that have {min_tph_2_peak} trips or more per hour during peak.')
print (f'There are {len(freq2a)} stops that have {min_tph_2_ext} trips or more per hour during extended hours.')
print (f'There are {len(frequent_stops)} stops associated with routes that have {min_tph_2_peak} or more trips per hour during the day and {min_tph_2_ext} trips or more per hour during all hours.')
print (f'There are {len(freq2w)} stops that have {min_tph_2_end} trips or more on Sundays.')
print (f'There are {len(frequent_stops2w)} stops associated with routes that have {min_tph_2_end} or more trips per hour during the weekends.')
print (f'There are {len(frequent_stops2)} stops that meet all criteria.')
print(set(frequent_stops2['stop_id'].tolist()))


## find stop_ids for Level4
# if 'level4' in LEVELS:
# identify stops with service in peak hours
freq3 = weekday_service.get_tph_at_stops() 
cols = []
for hour in peak_hours:
    freq3 = freq3[freq3[hour]>=min_tph_3_peak]
    freq3['frequent_sum'] = freq3[peak_hours].sum(axis=1)
freq3 = freq3[freq3['frequent_sum']>=min_tph_3_peak_8hour]

# aggregate headway of trips into routes by direction
all_trips = weekday_service.get_tph_by_line()
frequent_routes = pd.pivot_table(all_trips, values=all_hours, index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement
# at peak hours
cols = []
for hour in peak_hours:
    frequent_routes0 = frequent_routes[frequent_routes[hour]>=min_tph_3_peak]
frequent_routes0['frequent_sum'] = frequent_routes0[peak_hours].sum(axis=1)
frequent_routes0 = frequent_routes0[frequent_routes0['frequent_sum']>=min_tph_3_peak_8hour]
# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes0, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekday_service.get_line_stops_gdf()
frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]
frequent_stops = frequent_stops.drop_duplicates(subset=['stop_id'])

# merge to list from stop-level process
frequent_stops3 = freq3.merge(frequent_stops, how = 'inner', on = 'stop_id')
frequent_stops3 = frequent_stops3.drop_duplicates(subset=['stop_id'])

#print series of human readable sentences revealing how many stops were in each dataframe above
print (f'There are {len(freq3)} stops that have {min_tph_3_peak} trips or more per hour during peak.')
print (f'There are {len(frequent_stops)} stops associated with routes that have {min_tph_3_peak} or more trips per hour during the day.')
print (f'There are {len(frequent_stops3)} stops that meet all criteria.')
print(set(frequent_stops3['stop_id'].tolist()))


## find stop_ids for Level5 
# if 'level5' in LEVELS:
# identify stops with service in peak hourss
# freq4 = weekday_service.get_tph_at_stops() 
# cols = []
# for hour in peak_hours:
#     freq4 = freq4[freq4[hour]>=min_tph_4_peak]
#     freq4['frequent_sum'] = freq4[peak_hours].sum(axis=1)
# freq4 = freq4[freq4['frequent_sum']>=min_tph_4_peak_8hour]

# aggregate headway of trips into routes by direction
all_trips = weekday_service.get_total_trips_by_line()
frequent_routes = pd.pivot_table(all_trips, values="total_trips", index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement
frequent_routes = frequent_routes[frequent_routes['total_trips']>=min_tph_4_24hour]
# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekday_service.get_line_stops_gdf()
frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]
frequent_stops4 = frequent_stops.drop_duplicates(subset=['stop_id'])

# merge to list from stop-level process
# frequent_stops4 = freq4.merge(frequent_stops, how = 'inner', on = 'stop_id')
# frequent_stops4 = frequent_stops4.drop_duplicates(subset=['stop_id'])

#print series of human readable sentences revealing how many stops were in each dataframe above
print (f'There are {len(frequent_stops4)} stops that have {min_tph_4_24hour} trips or more during the day.')
print(set(frequent_stops4['stop_id'].tolist()))

if 'level6' in LEVELS:
## find stop_ids for Level1 

# identify stops with service in peak hours 
# freq5 = weekday_service.get_tph_at_stops() 
# cols = []
# for hour in peak_hours:
#     freq5 = freq5[freq5[hour]>=min_tph_5_peak]
#     freq5['frequent_sum'] = freq5[peak_hours].sum(axis=1)
# freq5 = freq5[freq5['frequent_sum']>=min_tph_5_peak_8hour]

# aggregate headway of trips into routes by direction
all_trips = weekday_service.get_total_trips_by_line()
frequent_routes = pd.pivot_table(all_trips, values="total_trips", index=["route_id","direction_id"], aggfunc=np.sum)
# identify routes meeting service level requirement
frequent_routes = frequent_routes[frequent_routes['total_trips']>=min_tph_5_24hour]
# identify trips associated with those routes
frequent_trips = all_trips.merge(frequent_routes, how='inner', on='route_id')
# identify stops associated with those trips
all_stops = weekday_service.get_line_stops_gdf()
frequent_stops = all_stops[all_stops['trip_id'].isin(frequent_trips['rep_trip_id'])]
frequent_stops5 = frequent_stops.drop_duplicates(subset=['stop_id'])

# merge to list from stop-level process
# frequent_stops5 = freq5.merge(frequent_stops, how = 'inner', on = 'stop_id')
# frequent_stops5 = frequent_stops5.drop_duplicates(subset=['stop_id'])

#print series of human readable sentences revealing how many stops were in each dataframe above
print (f'There are {len(frequent_stops5)} stops that have {min_tph_5_24hour} trips or more during the day.')
print(set(frequent_stops5['stop_id'].tolist()))

# merge with stops.txt, identify stops in layers ---- does not account for merging stops across feeds, but that shouldn't matter in this process because we will flatten frequency layers
OUTPUT = True
# if OUTPUT:
# add binary identifier to each level
frequent_stops0['level1']='1'
frequent_stops7['level2']='1'
frequent_stops2['level3']='1'
frequent_stops3['level4']='1'
frequent_stops4['level5']='1'
frequent_stops5['level6']='1'
frequent_stopsNights['levelNights']='1'

# select columns
frequent_stops0 = frequent_stops0[["stop_id", "level1"]]
frequent_stops7 = frequent_stops7[["stop_id", "level2"]]
frequent_stops2 = frequent_stops2[["stop_id", "level3"]]
frequent_stops3 = frequent_stops3[["stop_id", "level4"]]
frequent_stops4 = frequent_stops4[["stop_id", "level5"]]
frequent_stops5 = frequent_stops5[["stop_id", "level6"]]
frequent_stopsNights = frequent_stopsNights[["stop_id", "levelNights"]]

# grab stop lats and lons
stops = weekday_service.stops[["stop_id", "stop_lat", "stop_lon"]]

# merge dataframes
frequent_stops5 = frequent_stops5.merge(frequent_stops4, how = 'outer', on = 'stop_id')
frequent_stops5 = frequent_stops5.merge(frequent_stops3, how = 'outer', on = 'stop_id')
frequent_stops5 = frequent_stops5.merge(frequent_stops2, how = 'outer', on = 'stop_id')
frequent_stops5 = frequent_stops5.merge(frequent_stops7, how = 'outer', on = 'stop_id')
frequent_stops5 = frequent_stops5.merge(frequent_stops0, how = 'outer', on = 'stop_id')
frequent_stops5 = frequent_stops5.merge(frequent_stopsNights, how = 'outer', on = 'stop_id')
frequent_stops5 = frequent_stops5.merge(stops, how = 'outer', on = 'stop_id')

frequent_stops5.to_csv(sys.argv[1], index=False)