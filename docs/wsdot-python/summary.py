import csv
import sys
import collections

# {'': '22257', 'stop_id': 'SCH_755000', 'level6': '', 'level5': '', 'level4': '', 'level3': '', 'level2': '', 'level1': '', 'levelNights': '', 'stop_lat': '47.663434', 'stop_lon': '-122.282835'}
count_keys = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'levelNights']
counts = collections.defaultdict(int)
with open(sys.argv[1], 'r') as f:
    csv = csv.DictReader(f)
    for row in csv:
        for key in count_keys:
            v = int(row.get(key) or '0')
            counts[key] += v

for k in count_keys:
    print(f"{k}: {counts[k]}")