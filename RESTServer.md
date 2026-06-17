# RESTServer Documentation
Base URL: http://localhost:<port>

### PUT /dataset/:id/:kind
Add a new dataset to the system
#### URL parameters
- id: string
- kind: InsightDatasetKind
#### Request properties
- content: string that represents the dataset zip file
#### Sample response
{
  "result": ["sections", "rooms"]
}
### DELETE /dataset/:id
Remove a dataset from the system
#### URL parameters
- id: string
#### Sample response
{
  "result": ["sections", "rooms"]
}
### GET /datasets
Retreive list of all dataset ids in the system
#### No request properties or URL parameters
#### Sample response
{
  "result": [
    {
      "id": "sections",
      "kind": "sections",
      "numRows": 64612
    },
    {
      "id": "rooms",
      "kind": "rooms",
      "numRows": 364
    }
  ]
}
### POST /query
Perform a query of a dataset
#### Request properties 
- WHERE: object
- OPTIONS: object
#### Sample response
{
  "result": {
    "id": "sections",
    "numRows": 64612,
    "averageGrade": 72.4
  }
}

### GET /dataset/:id/avggrade
Gets the overall average of the selected (sections) dataset  
Average is calculated by: sum(section enrollments * average section grade)/(total enrollments)
#### URL parameters
- id: string that represents the dataset to compute the average for
#### Sample response
{
  "result":{
 	"datasetId":"sections",
   	"averageGrade":76.76,
  }
}
